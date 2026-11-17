import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRoute, request } from './route-contract.mjs';

const origin='https://evaluation.example.invalid';
function scenario() {
  const s={current:'U12345A',identity:'U12345B',configured:true,flow:null,issued:null,writes:0};
  const auth={ADMIN_OAUTH_COOKIE:'ee_admin_oauth',ADMIN_SESSION_COOKIE:'ee_admin_session',
    appOrigin:()=>origin,cookieOptions:maxAge=>({path:'/',maxAge,httpOnly:true}),
    slackAuthConfigured:()=>s.configured,
    signOAuthFlow:flow=>{s.flow=flow;return 'signed-flow';},
    parseOAuthFlow:()=>s.flow,
    exchangeSlackCode:async()=>({email:'b@example.invalid',slackUserId:s.identity}),
    findHrEvaluationStaff:async()=>{s.writes++;return {name:'B',department:'교육운영팀'};},roleForStaff:()=> 'general_admin'};
  const db={from:()=>({
    select:()=>({eq:()=>({maybeSingle:async()=>({error:null,data:null})})}),
    upsert:()=>({select:()=>({single:async()=>({error:null,data:{id:'B',is_active:true}})})}),
    insert:async()=>({error:null}),
  })};
  const mocks={'@/lib/slackAdminAuth':auth,'@/lib/supabaseServer':{getSupabaseAdmin:()=>db},
    '@/lib/adminAuth':{getAdminSessionFromRequest:()=>({slackUserId:s.current}),
      hashIp:()=>'',getRequestIp:()=>'',createAdminSessionToken:value=>{s.issued=value;return 'session-B';}}};
  return {s,start:loadRoute(new URL('../app/api/admin/auth/slack/route.ts',import.meta.url),mocks).GET,
    callback:loadRoute(new URL('../app/api/admin/auth/slack/callback/route.ts',import.meta.url),mocks).GET};
}
test('portal B constraint clears A, survives OAuth state and creates only the verified B session',async()=>{
  const {s,start,callback}=scenario();
  const response=await start(request(origin+'/api/admin/auth/slack?portal_slack_user=U12345B'));
  assert.equal(response.savedCookies.get('ee_admin_session').value,'');
  assert.equal(s.flow.expectedSlackUserId,'U12345B');
  const done=await callback(request(origin+`/api/admin/auth/slack/callback?code=ok&state=${s.flow.state}`,{ee_admin_oauth:'signed-flow'}));
  assert.equal(done.savedCookies.get('ee_admin_session').value,'session-B');
  assert.equal(s.issued.slackUserId,'U12345B'); assert.equal(s.issued.role,'general_admin');
});
test('Slack returning A or cancelling never restores the old A session',async()=>{
  const {s,start,callback}=scenario();
  await start(request(origin+'/api/admin/auth/slack?portal_slack_user=U12345B')); s.identity='U12345A';
  const denied=await callback(request(origin+`/api/admin/auth/slack/callback?code=wrong&state=${s.flow.state}`,{ee_admin_oauth:'signed-flow'}));
  assert.match(denied.headers.get('location'),/account_mismatch/);
  assert.equal(denied.savedCookies.get('ee_admin_session').value,''); assert.equal(s.writes,0);assert.equal(s.issued,null);
  const cancelled=await callback(request(origin+'/api/admin/auth/slack/callback?error=access_denied'));
  assert.equal(cancelled.savedCookies.get('ee_admin_session').value,'');
});
test('matching B reuses only B, while malformed constraints and setup failures clear old sessions',async()=>{
  const {s,start}=scenario();s.current='U12345B';
  assert.equal((await start(request(origin+'/api/admin/auth/slack?portal_slack_user=U12345B'))).headers.get('location'),origin+'/admin');
  assert.equal(s.flow,null);
  assert.equal((await start(request(origin+'/api/admin/auth/slack?portal_slack_user=invalid'))).status,400);
  s.current='U12345A';s.configured=false;
  const unavailable=await start(request(origin+'/api/admin/auth/slack?portal_slack_user=U12345B'));
  assert.equal(unavailable.status,503);assert.equal(unavailable.savedCookies.get('ee_admin_session').value,'');
});

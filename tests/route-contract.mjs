import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
export class ContractResponse extends Response {
  savedCookies = new Map();
  cookies = {
    set: (name, value, options) => this.savedCookies.set(name, {value, options}),
    delete: name => this.savedCookies.set(name, {value:'',options:{maxAge:0}}),
  };
  static redirect(url, status = 307) { return new ContractResponse(null, {status,headers:{location:String(url)}}); }
  static json(body, init = {}) { return new ContractResponse(JSON.stringify(body), {...init,headers:{'content-type':'application/json',...init.headers}}); }
}
export function request(url, values = {}) {
  return { url, nextUrl:new URL(url), headers:new Headers(), cookies:{get:name=>name in values?{value:values[name]}:undefined} };
}
export function loadRoute(url, mocks) {
  const source = fs.readFileSync(url, 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {exports,URL,URLSearchParams,Buffer,Date,Response,Headers,
    process:{env:{NODE_ENV:'test',SLACK_CLIENT_ID:'synthetic',SLACK_TEAM_ID:'T123456'}},
    console:{error(){},warn(){}},require:name=>{
      if(name==='next/server')return {NextResponse:ContractResponse};
      if(name in mocks)return mocks[name];
      if(name.startsWith('node:'))return nativeRequire(name);
      throw new Error('Unmocked dependency: '+name);
    }});
  return exports;
}

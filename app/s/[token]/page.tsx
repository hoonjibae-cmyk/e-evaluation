import SurveyClient from "./SurveyClient";

export default function SurveyPage({ params }: { params: { token: string } }) {
  return <SurveyClient token={params.token} />;
}

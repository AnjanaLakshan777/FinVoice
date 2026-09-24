/**
 * Response body returned by every FinVoice service health endpoint (`GET /health`).
 */
export type ServiceHealth = {
  status: "ok";
  service: string;
};

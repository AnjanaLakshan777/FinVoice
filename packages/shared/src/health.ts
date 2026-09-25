/**
 * Response body returned by every FinVoice service health endpoint (`GET /health`).
 * Liveness only: it does not check dependencies.
 */
export type ServiceHealth = {
  status: "ok";
  service: string;
};

export type DependencyStatus = "up" | "down";

/**
 * Response body of a service readiness endpoint (`GET /health/ready`): whether the
 * service's dependencies are reachable and it can serve traffic.
 */
export type ServiceReadiness = {
  status: "ok" | "error";
  service: string;
  checks: Record<string, DependencyStatus>;
};

// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Config } from "../config.js";

export interface StewardIdentity {
  stewardId: string;
}

function bearer(req: FastifyRequest): string | null {
  const header = req.headers["authorization"];
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(String(header));
  return match ? match[1]!.trim() : null;
}

/** Resolve the steward identity from a bearer token, or null if not a steward. */
export function authenticateSteward(req: FastifyRequest, config: Config): StewardIdentity | null {
  const token = bearer(req);
  if (!token) return null;
  if (config.STEWARD_TOKENS.includes(token)) {
    return { stewardId: `steward:${token.slice(0, 6)}` };
  }
  return null;
}

/** Read the steward identity attached by `requireSteward` for the current request. */
export function getSteward(req: FastifyRequest): StewardIdentity {
  const id = (req as FastifyRequest & { steward?: StewardIdentity }).steward;
  if (!id) throw new Error("getSteward called without requireSteward preHandler");
  return id;
}

/**
 * Fastify preHandler enforcing the steward role. Returns 503 when no steward
 * tokens are configured (auth disabled), 401 when the bearer token is missing
 * or invalid.
 */
export function requireSteward(config: Config): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (config.STEWARD_TOKENS.length === 0) {
      return reply.code(503).send({ error: "steward_auth_unconfigured" });
    }
    const id = authenticateSteward(req, config);
    if (!id) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    (req as FastifyRequest & { steward?: StewardIdentity }).steward = id;
  };
}

import type { FinancialProfileResponse } from "@finvoice/contracts";

import { ApiError, type AuthClient } from "../auth/auth-client";

/** The signed-in person's financial profile, or null if they have none yet (the API's 404). */
export async function loadProfile(client: AuthClient): Promise<FinancialProfileResponse | null> {
  try {
    return await client.request<FinancialProfileResponse>("GET", "/me/financial-profile");
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) {
      return null;
    }
    throw caught;
  }
}

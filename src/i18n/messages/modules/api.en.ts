import type { apiDe } from "./api.de";

export const apiEn: typeof apiDe = {
  errors: {
    scopeNotSubset: "A token may only contain rights that you have yourself.",
    scopeForbidden: "Administration rights and sensitive employee data cannot be granted to an API token.",
  },
};

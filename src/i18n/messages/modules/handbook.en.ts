import type { handbookDe } from "./handbook.de";

export const handbookEn: typeof handbookDe = {
  feature: {
    name: "Handbook",
    description: "Documentation of the application: architecture, development and operations.",
  },
  title: "Handbook",
  description: "Technical documentation of the application for platform administrators and developers.",
  contents: "Contents",
  catalogTitle: "Catalogue",
  catalogDescription: "All modules and features with dependencies, permissions and pages – generated from the code.",
  catalog: {
    features: "Features",
    requires: "Requires",
    uses: "Works together with",
    permissions: "Permissions",
    routes: "Pages",
    required: "Required",
    none: "–",
  },
  notFound: "This handbook page does not exist.",
};

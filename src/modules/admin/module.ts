import { defineModule } from "@/modules/define";

export const adminModule = defineModule({
  id: "admin",
  nameKey: "areas.admin",
  descriptionKey: "modules.descriptions.admin",
  order: 5,
  required: true,
});

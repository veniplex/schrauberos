import type { usersDe } from "./users.de";

export const usersEn: typeof usersDe = {
  feature: {
    name: "Users",
    description: "Manage user accounts and roles; sign-in locally or (later) via Active Directory.",
  },
  title: "Users",
  description: "Who may sign in and which roles do they have?",
  new: "Add user",
  edit: "Edit user",
  delete: "Delete user",
  confirmDelete: "Really delete user “{name}”?",
  cols: { user: "User", roles: "Roles", source: "Sign-in", lastLogin: "Last sign-in" },
  linkedEmployee: "Employee: {name}",
  sourceLocal: "Local",
  active: "Active",
  inactive: "Disabled",
  fields: {
    username: "Username",
    usernameHint: "Lowercase letters, digits, dot, hyphen and underscore. Cannot be changed later.",
    name: "Display name",
    email: "Email",
    authSource: "Sign-in source",
    password: "Password",
    passwordReset: "New password",
    passwordResetHint: "Leave empty to keep the current password.",
    roles: "Roles",
    active: "Account is active",
    mustChangePassword: "Require a password change at next sign-in",
  },
  errors: {
    adminRoleRestricted: "Administrator roles can only be granted or revoked by administrators.",
    lastAdmin: "At least one active administrator must remain.",
    selfDeactivate: "You cannot disable your own account.",
    usernameTaken: "This username is already taken.",
  },
};

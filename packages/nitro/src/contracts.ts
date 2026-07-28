export type NitroProductionCredentials = {
  environment?: string;
  authSecret?: string;
  bootstrap?: {
    email?: string;
    password?: string;
  };
};

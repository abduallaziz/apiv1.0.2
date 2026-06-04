export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tenant_id: string | null;
  session_id: string;
}
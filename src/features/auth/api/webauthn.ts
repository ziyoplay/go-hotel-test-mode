import { useMutation, useQuery } from "@tanstack/react-query";
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { api } from "@/lib/api";

// Backend endpointlari (WebAuthn/passkey oqimi), har biri bir martalik
// challenge_id bilan bog'lanadi (register_options/login_options tomonidan
// qaytariladi, tegishli */verify chaqiruvida qaytarib yuboriladi):
//   GET  /auth/webauthn/register/options  (auth talab qiladi)  -> { challenge_id, options }
//   POST /auth/webauthn/register/verify   (auth talab qiladi)  <- { challenge_id, credential }
//   GET  /auth/webauthn/passkeys          (auth talab qiladi)  -> Passkey[]
//   DELETE /auth/webauthn/passkeys/:id    (auth talab qiladi)
//   POST /auth/webauthn/login/options     (ochiq)              -> { challenge_id, options }
//   POST /auth/webauthn/login/verify      (ochiq)              <- { challenge_id, credential }
//                                                                 -> { access_token, refresh_token }

export interface Passkey {
  id: string;
  device_label?: string;
  created_at: string;
  last_used_at?: string | null;
}

// Ro'yxatdan o'tgan foydalanuvchi uchun yangi passkey (Face ID) qo'shish
export function useRegisterPasskey() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.get<{
        challenge_id: string;
        options: PublicKeyCredentialCreationOptionsJSON;
      }>("/auth/webauthn/register/options");
      const attestationResponse = await startRegistration({ optionsJSON: data.options });
      const { data: result } = await api.post("/auth/webauthn/register/verify", {
        challenge_id: data.challenge_id,
        credential: attestationResponse,
      });
      return result;
    },
  });
}

export function usePasskeys() {
  return useQuery({
    queryKey: ["webauthn", "passkeys"],
    queryFn: async () => {
      const { data } = await api.get<Passkey[]>("/auth/webauthn/passkeys");
      return data;
    },
  });
}

export function useDeletePasskey() {
  return useMutation({
    mutationFn: async (passkeyId: string) => {
      await api.delete(`/auth/webauthn/passkeys/${passkeyId}`);
    },
  });
}

// Face ID/passkey orqali kirish. `username` berilmasa, brauzer saqlangan
// hisoblarni discoverable credential sifatida ko'rsatadi.
export async function loginWithPasskey(username?: string) {
  const { data } = await api.post<{
    challenge_id: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>("/auth/webauthn/login/options", username ? { username } : {});
  const assertionResponse = await startAuthentication({ optionsJSON: data.options });
  const { data: result } = await api.post<{ access_token: string; refresh_token: string }>(
    "/auth/webauthn/login/verify",
    { challenge_id: data.challenge_id, credential: assertionResponse }
  );
  return result;
}

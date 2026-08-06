import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Kamera orqali yuz bilan kirish: brauzer face-api modellari yordamida
// 128 o'lchamli yuz imzosini (descriptor) hisoblaydi, backend esa uni
// saqlaydi (enroll) va solishtiradi (login).
//   POST /auth/face/enroll        (auth kerak)  <- { embedding }
//   GET  /auth/face/profiles      (auth kerak)  -> FaceProfile[]
//   DELETE /auth/face/profiles/:id (auth kerak)
//   POST /auth/face/login         (ochiq)       <- { embedding } -> tokenlar

export interface FaceProfile {
  id: string;
  device_label?: string | null;
  created_at: string;
  last_used_at?: string | null;
}

const MODEL_URL = "/models/face-api";
// face-api (tfjs bilan) og'ir kutubxona — asosiy bundle'ni shishirmaslik uchun
// faqat kamera ochilganda dynamic import orqali yuklanadi.
let faceapiModule: typeof import("@vladmandic/face-api") | null = null;

export async function loadFaceModels(): Promise<void> {
  if (faceapiModule) return;
  const faceapi = await import("@vladmandic/face-api");
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  faceapiModule = faceapi;
}

// Videodagi kadrdan yuz imzosini hisoblaydi. Yuz topilmasa null qaytaradi.
export async function computeDescriptor(
  video: HTMLVideoElement
): Promise<number[] | null> {
  if (!faceapiModule) await loadFaceModels();
  const faceapi = faceapiModule!;
  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return null;
  return Array.from(detection.descriptor);
}

export async function faceLogin(embedding: number[]) {
  const { data } = await api.post<{ access_token: string; refresh_token: string }>(
    "/auth/face/login",
    { embedding }
  );
  return data;
}

export function useEnrollFace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (embedding: number[]) => {
      const { data } = await api.post("/auth/face/enroll", { embedding });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["face", "profiles"] }),
  });
}

export function useFaceProfiles() {
  return useQuery({
    queryKey: ["face", "profiles"],
    queryFn: async () => {
      const { data } = await api.get<FaceProfile[]>("/auth/face/profiles");
      return data;
    },
  });
}

export function useDeleteFaceProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string) => {
      await api.delete(`/auth/face/profiles/${profileId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["face", "profiles"] }),
  });
}

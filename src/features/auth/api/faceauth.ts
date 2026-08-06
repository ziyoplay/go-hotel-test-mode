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

// Modellarni oldindan (fonda) yuklab qo'yish — kamera ochilganda kutish
// bo'lmasligi uchun login/sozlamalar sahifasi ochilishida chaqiriladi.
export function preloadFaceModels(): void {
  loadFaceModels().catch(() => {
    // Fon yuklash xatosi jim o'tadi — dialog ochilganda qayta uriniladi
  });
}

// Videodagi kadrdan yuz imzosini hisoblaydi. Yuz topilmasa null qaytaradi.
// inputSize kattaroq (416) — aniqroq aniqlash; scoreThreshold xira/shubhali
// kadrlarni tashlab yuboradi, ular imzo sifatini buzmasin.
export async function computeDescriptor(
  video: HTMLVideoElement
): Promise<number[] | null> {
  if (!faceapiModule) await loadFaceModels();
  const faceapi = faceapiModule!;
  const detection = await faceapi
    .detectSingleFace(
      video,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })
    )
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return null;
  return Array.from(detection.descriptor);
}

// Bir nechta imzoning o'rtachasi — yorug'lik/burchak shovqinini kamaytiradi
export function averageDescriptors(samples: number[][]): number[] {
  const n = samples.length;
  const out = new Array<number>(samples[0].length).fill(0);
  for (const s of samples) {
    for (let i = 0; i < s.length; i++) out[i] += s[i];
  }
  return out.map((v) => v / n);
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

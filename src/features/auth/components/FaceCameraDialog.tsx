import { useEffect, useRef, useState } from "react";
import { Loader2, ScanFace } from "lucide-react";
import {
  loadFaceModels,
  computeDescriptor,
  averageDescriptors,
} from "@/features/auth/api/faceauth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface FaceCameraDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  // Nechta kadrdan imzo yig'ib o'rtachasini olish (ro'yxatdan o'tishda 3 —
  // aniqroq; kirishda 1 — tezroq).
  samples?: number;
  // Yuz imzosi hisoblangach chaqiriladi. Xato matnini qaytarsa, dialog
  // ochiq qoladi va qayta urinish davom etadi; null/undefined — yopiladi.
  onDescriptor: (embedding: number[]) => Promise<string | void>;
}

// Kamerani ochib, yuz topilguncha uzluksiz urinadigan dialog.
// Kadrlar ketma-ket (oldingisi tugashi bilan) qayta ishlanadi — sekin
// qurilmada ham navbat yig'ilib qolmaydi.
export const FaceCameraDialog = ({
  open,
  onOpenChange,
  title,
  samples = 1,
  onDescriptor,
}: FaceCameraDialogProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<string>("Kamera ochilmoqda...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const collected: number[][] = [];
    setError(null);
    setStatus("Tayyorlanmoqda...");

    const stop = () => {
      if (timeout) clearTimeout(timeout);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    const tick = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        const embedding = await computeDescriptor(video);
        if (cancelled) return;
        if (embedding) {
          collected.push(embedding);
          if (collected.length < samples) {
            setStatus(`Namuna ${collected.length}/${samples} olindi...`);
          } else {
            setStatus("Tekshirilmoqda...");
            const finalEmbedding =
              samples > 1 ? averageDescriptors(collected) : collected[0];
            collected.length = 0;
            const errMsg = await onDescriptor(finalEmbedding);
            if (cancelled) return;
            if (errMsg) {
              setError(errMsg);
              setStatus("Yuzingizni kameraga qarating...");
            } else {
              stop();
              onOpenChange(false);
              return;
            }
          }
        } else if (collected.length === 0) {
          setStatus("Yuzingizni kameraga qarating...");
        }
      }
      // Oldingi kadr qayta ishlanib bo'lgach darhol keyingisi — sun'iy
      // kutish deyarli yo'q (50ms UI nafas olishi uchun)
      timeout = setTimeout(tick, 50);
    };

    (async () => {
      if (!window.isSecureContext) {
        setError("Kamera faqat HTTPS yoki localhost'da ishlaydi.");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Brauzeringiz kamerani qo'llab-quvvatlamaydi.");
        return;
      }
      try {
        // Modellar odatda sahifa ochilishida preload qilingan — bu chaqiruv
        // shunchaki tayyor bo'lishini kutadi
        await loadFaceModels();
      } catch {
        setError("Yuz aniqlash modellari yuklanmadi. Internetni tekshiring.");
        return;
      }
      if (cancelled) return;
      setStatus("Kamera ochilmoqda...");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err: any) {
        switch (err?.name) {
          case "NotAllowedError":
            setError("Kameraga ruxsat berilmadi. Brauzer sozlamalaridan kamera ruxsatini yoqing.");
            break;
          case "NotFoundError":
            setError("Kamera topilmadi. Qurilmada veb-kamera borligini tekshiring.");
            break;
          case "NotReadableError":
            setError("Kamera band — boshqa dastur ishlatmoqda.");
            break;
          default:
            setError("Kamerani ochib bo'lmadi.");
        }
        return;
      }

      setStatus("Yuzingizni kameraga qarating...");
      tick();
    })();

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanFace className="h-5 w-5" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          {error && (
            <div className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-600">
              {error}
            </div>
          )}
          <div className="relative w-full">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-64 w-full rounded-lg bg-black object-cover [transform:scaleX(-1)]"
            />
            <div className="absolute inset-x-0 bottom-2 flex justify-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
                <Loader2 className="h-3 w-3 animate-spin" />
                {status}
              </span>
            </div>
          </div>
        </div>

        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Bekor qilish
        </Button>
      </DialogContent>
    </Dialog>
  );
};

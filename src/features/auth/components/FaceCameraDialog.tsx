import { useEffect, useRef, useState } from "react";
import { Loader2, ScanFace } from "lucide-react";
import { loadFaceModels, computeDescriptor } from "@/features/auth/api/faceauth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface FaceCameraDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  // Yuz imzosi hisoblangach chaqiriladi. Xato matnini qaytarsa, dialog
  // ochiq qoladi va qayta urinish davom etadi; null/undefined — yopiladi.
  onDescriptor: (embedding: number[]) => Promise<string | void>;
}

// Kamerani ochib, yuz topilguncha har 700ms da urinadigan dialog.
// Yuz topilgach onDescriptor chaqiriladi (login yoki enroll).
export const FaceCameraDialog = ({ open, onOpenChange, title, onDescriptor }: FaceCameraDialogProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const [status, setStatus] = useState<string>("Kamera ochilmoqda...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    setError(null);
    setStatus("Modellar yuklanmoqda...");

    const stop = () => {
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
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
        await loadFaceModels();
      } catch {
        setError("Yuz aniqlash modellari yuklanmadi. Internetni tekshiring.");
        return;
      }
      if (cancelled) return;
      setStatus("Kamera ochilmoqda...");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
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
      timer = setInterval(async () => {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || busyRef.current || cancelled) return;
        busyRef.current = true;
        try {
          const embedding = await computeDescriptor(video);
          if (cancelled) return;
          if (!embedding) {
            setStatus("Yuz topilmadi — kameraga yaqinroq qarating...");
            return;
          }
          setStatus("Tekshirilmoqda...");
          const errMsg = await onDescriptor(embedding);
          if (cancelled) return;
          if (errMsg) {
            setStatus("Yuzingizni kameraga qarating...");
            setError(errMsg);
          } else {
            stop();
            onOpenChange(false);
          }
        } finally {
          busyRef.current = false;
        }
      }, 700);
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
          {error ? (
            <div className="flex h-64 w-full items-center justify-center rounded-lg bg-gray-100 px-4 text-center text-sm text-red-600">
              {error}
            </div>
          ) : (
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
          )}
        </div>

        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Bekor qilish
        </Button>
      </DialogContent>
    </Dialog>
  );
};

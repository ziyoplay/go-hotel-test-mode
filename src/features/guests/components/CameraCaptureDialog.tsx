import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface CameraCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (file: File) => void;
}

// Mehmon suratini fayl tanlash o'rniga to'g'ridan-to'g'ri kameradan
// ("yuzidan") olish uchun dialog. WebRTC getUserMedia orqali kamerani ochadi,
// kadrni canvasga chizib JPEG faylga aylantiradi.
export const CameraCaptureDialog = ({ open, onOpenChange, onCapture }: CameraCaptureDialogProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    if (!open) {
      stopStream();
      setSnapshot(null);
      setError(null);
      return;
    }

    let cancelled = false;

    if (!window.isSecureContext) {
      setError(
        "Kamera faqat xavfsiz ulanishda (HTTPS yoki localhost) ishlaydi. Sayt HTTP orqali ochilgan."
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Brauzeringiz kamerani qo'llab-quvvatlamaydi.");
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((err: any) => {
        if (cancelled) return;
        switch (err?.name) {
          case "NotAllowedError":
          case "SecurityError":
            setError(
              "Kameraga ruxsat berilmadi. Brauzer manzil satridagi qulf belgisidan kamera ruxsatini yoqing."
            );
            break;
          case "NotFoundError":
          case "OverconstrainedError":
            setError(
              "Kamera topilmadi. Qurilmada veb-kamera borligini va u boshqa dastur (Zoom, Teams...) tomonidan band qilinmaganini tekshiring. Windows'da: Sozlamalar → Maxfiylik va xavfsizlik → Kamera → brauzerga ruxsat berilganini tekshiring."
            );
            break;
          case "NotReadableError":
            setError("Kameraga ulanib bo'lmadi — u boshqa dastur tomonidan band.");
            break;
          default:
            setError("Kamerani ochib bo'lmadi: " + (err?.message || "noma'lum xatolik"));
        }
      });

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setSnapshot(canvas.toDataURL("image/jpeg", 0.92));
  };

  const retake = () => setSnapshot(null);

  const confirm = () => {
    if (!snapshot) return;
    const arr = snapshot.split(",");
    const bstr = atob(arr[1]);
    const u8 = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
    const file = new File([u8], `face-${Date.now()}.jpg`, { type: "image/jpeg" });
    onCapture(file);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Yuzdan surat olish</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          {error ? (
            <div className="flex h-64 w-full items-center justify-center rounded-lg bg-gray-100 px-4 text-center text-sm text-red-600">
              {error}
            </div>
          ) : snapshot ? (
            <img src={snapshot} alt="" className="h-64 w-full rounded-lg object-cover" />
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-64 w-full rounded-lg bg-black object-cover [transform:scaleX(-1)]"
            />
          )}
        </div>

        <DialogFooter>
          {snapshot ? (
            <>
              <Button variant="outline" onClick={retake}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Qayta olish
              </Button>
              <Button onClick={confirm}>
                <Check className="h-4 w-4 mr-2" />
                Ishlatish
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4 mr-2" />
                Bekor qilish
              </Button>
              <Button onClick={capture} disabled={!!error}>
                <Camera className="h-4 w-4 mr-2" />
                Suratga olish
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

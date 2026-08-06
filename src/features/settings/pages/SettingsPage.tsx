import { useEffect, useState } from "react"
import {
  Settings,
  AlertTriangle,
  Trash2,
  Loader2,
  CheckCircle2,
  Database,
  Users,
  ScanFace,
  ShieldCheck,
} from "lucide-react"
import { useResetData, type ResetDataResult } from "../api/maintenance"
import {
  preloadFaceModels,
  useDeleteFaceProfile,
  useEnrollFace,
  useFaceProfiles,
} from "@/features/auth/api/faceauth"
import { FaceCameraDialog } from "@/features/auth/components/FaceCameraDialog"
import { usePermissions } from "@/lib/permissions"
import { useAuthStore } from "@/store/auth"
import { apiErrorMessage } from "@/lib/apiError"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const SecuritySection = () => {
  const [error, setError] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const { data: profiles, isLoading } = useFaceProfiles()
  const enrollMutation = useEnrollFace()
  const deleteMutation = useDeleteFaceProfile()

  // Modellarni fonda oldindan yuklaymiz — tugma bosilganda kutish bo'lmasin
  useEffect(() => {
    preloadFaceModels()
  }, [])

  // Kameradan olingan yuz imzosini serverga saqlaymiz
  const onDescriptor = async (embedding: number[]): Promise<string | void> => {
    try {
      await enrollMutation.mutateAsync(embedding)
      setError(null)
    } catch (err: any) {
      return apiErrorMessage(err)
    }
  }

  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-center gap-2 border-b bg-gray-50/60 px-4 py-3 rounded-t-md">
        <ShieldCheck className="h-4 w-4 text-gray-500" />
        <h2 className="text-sm font-bold text-gray-800">Yuz bilan kirish</h2>
      </div>
      <div className="p-4 space-y-4">
        <p className="text-sm text-gray-600">
          Kameraga qarab yuzingizni ro'yxatdan o'tkazing — keyin login sahifasida
          parol o'rniga yuz orqali kira olasiz.
        </p>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 whitespace-pre-line">
            {error}
          </div>
        )}

        {!isLoading && profiles && profiles.length > 0 && (
          <div className="space-y-2">
            {profiles.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="text-sm">
                  <div className="font-medium text-gray-800">
                    {p.device_label || "Noma'lum qurilma"}
                  </div>
                  <div className="text-xs text-gray-500">
                    Qo'shildi: {new Date(p.created_at).toLocaleDateString()}
                    {p.last_used_at &&
                      ` · Oxirgi kirish: ${new Date(p.last_used_at).toLocaleDateString()}`}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(p.id)}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <Button
          variant="outline"
          disabled={enrollMutation.isPending}
          onClick={() => {
            setError(null)
            setCameraOpen(true)
          }}
        >
          {enrollMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <ScanFace className="h-4 w-4 mr-2" />
          )}
          Yuzni ro'yxatdan o'tkazish
        </Button>
      </div>

      <FaceCameraDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        title="Yuzni ro'yxatdan o'tkazish"
        samples={3}
        onDescriptor={onDescriptor}
      />
    </div>
  )
}

// Natija jadvalidagi nomlarni o'zbekchaga o'girish
const TABLE_LABELS: Record<string, string> = {
  checklist_items: "Chek-list bandlari",
  invoice_items: "Hisob-faktura bandlari",
  problems: "Muammolar",
  housekeeping_tasks: "Xo'jalik vazifalari",
  reservation_services: "Bron xizmatlari",
  payments: "To'lovlar",
  invoice_line_items: "Hisob-faktura qatorlari",
  journal_entry_lines: "Jurnal qatorlari",
  journal_entries: "Jurnal yozuvlari",
  invoices: "Hisob-fakturalar",
  reservations: "Bronlar",
  guests: "Mehmonlar",
  notifications: "Bildirishnomalar",
  audit_logs: "Audit loglari",
  reports: "Hisobotlar",
  room_status_history: "Xona holati tarixi",
  file_attachments: "Fayllar",
  rooms_reset: "Bo'sh holatga qaytarilgan xonalar",
  user_permissions: "Ruxsat biriktiruvlari",
  user_sessions: "Xodim sessiyalari",
  users: "Xodimlar",
}

export const SettingsPage = () => {
  const { isAdmin } = usePermissions()
  const user = useAuthStore((s) => s.user)
  const resetMutation = useResetData()

  const [scope, setScope] = useState<"operational" | "full">("operational")
  const [confirmText, setConfirmText] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [result, setResult] = useState<ResetDataResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const canSubmit = confirmText.trim().toUpperCase() === "RESET"

  const onExecute = async () => {
    setErrorMsg(null)
    try {
      const res = await resetMutation.mutateAsync({
        scope,
        hotelId: user?.hotel_id,
      })
      setResult(res)
      setDialogOpen(false)
      setConfirmText("")
    } catch (e) {
      setErrorMsg(apiErrorMessage(e))
      setDialogOpen(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Sozlamalar</h1>
        <SecuritySection />
      </div>
    )
  }

  const options = [
    {
      key: "operational" as const,
      icon: Database,
      title: "Operatsion ma'lumotlarni tozalash",
      description:
        "Bronlar, hisob-fakturalar, to'lovlar, mehmonlar, xo'jalik vazifalari, bildirishnomalar va tarix o'chiriladi.",
      keeps: "Saqlanadi: xodimlar, ruxsatlar, xonalar, qavatlar, turlar, xizmatlar.",
    },
    {
      key: "full" as const,
      icon: Users,
      title: "To'liq tozalash (xodimlar bilan)",
      description:
        "Yuqoridagilarga qo'shimcha: barcha xodimlar (EMPLOYEE), ularning ruxsatlari va sessiyalari ham o'chiriladi.",
      keeps: "Saqlanadi: administrator hisoblari, ruxsatlar katalogi va mehmonxona tuzilmasi.",
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
          <Settings className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sozlamalar</h1>
          <p className="text-sm text-gray-500">Tizim boshqaruvi</p>
        </div>
      </div>

      <SecuritySection />

      {/* Muvaffaqiyat xabari */}
      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
            <CheckCircle2 className="h-4 w-4" />
            {result.message} — jami {result.total_deleted} ta yozuv o'chirildi
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-1">
            {Object.entries(result.deleted)
              .filter(([, n]) => n > 0)
              .map(([table, n]) => (
                <div key={table} className="flex justify-between text-xs text-emerald-800">
                  <span>{TABLE_LABELS[table] || table}</span>
                  <span className="font-semibold">{n}</span>
                </div>
              ))}
          </div>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 whitespace-pre-line">
          {errorMsg}
        </div>
      )}

      {/* Xavfli hudud */}
      <div className="rounded-lg border-2 border-red-200 bg-white">
        <div className="flex items-center gap-2 border-b border-red-100 bg-red-50/60 px-4 py-3 rounded-t-md">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          <h2 className="text-sm font-bold text-red-700">
            Xavfli hudud — ma'lumotlarni tozalash (Reset)
          </h2>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-600">
            Tizimni "yangidek" holatga qaytarish. Bu amal{" "}
            <span className="font-semibold text-red-600">qaytarib bo'lmaydi</span> va
            faqat sizning mehmonxonangiz ma'lumotlariga ta'sir qiladi.
          </p>

          {/* Rejim tanlash */}
          <div className="grid gap-3 md:grid-cols-2">
            {options.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setScope(opt.key)}
                className={cn(
                  "rounded-lg border p-4 text-left transition-all",
                  scope === opt.key
                    ? "border-red-400 ring-2 ring-red-400/30 bg-red-50/40"
                    : "border-gray-200 hover:border-red-200 hover:bg-gray-50"
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg",
                      scope === opt.key
                        ? "bg-red-100 text-red-600"
                        : "bg-gray-100 text-gray-500"
                    )}
                  >
                    <opt.icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{opt.title}</span>
                </div>
                <p className="mt-2 text-xs text-gray-600 leading-snug">{opt.description}</p>
                <p className="mt-1.5 text-[11px] text-emerald-700 leading-snug">{opt.keeps}</p>
              </button>
            ))}
          </div>

          {/* Tasdiqlash */}
          <div className="flex flex-wrap items-end gap-3 border-t pt-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">
                Tasdiqlash uchun <span className="font-mono font-bold">RESET</span> deb yozing
              </label>
              <Input
                className="w-56"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="RESET"
              />
            </div>
            <Button
              variant="destructive"
              disabled={!canSubmit || resetMutation.isPending}
              onClick={() => setDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Tozalashni boshlash
            </Button>
          </div>
        </div>
      </div>

      {/* Yakuniy tasdiqlash dialogi */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Rostdan ham tozalaysizmi?
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2 text-sm text-gray-600">
            <p>
              Tanlangan rejim:{" "}
              <span className="font-semibold text-gray-900">
                {options.find((o) => o.key === scope)?.title}
              </span>
            </p>
            <p>
              Bu amal <span className="font-semibold text-red-600">qaytarib bo'lmaydi</span>.
              {scope === "full" &&
                " Barcha xodimlar o'chiriladi — faqat administrator hisoblari qoladi."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Bekor qilish
            </Button>
            <Button
              variant="destructive"
              onClick={onExecute}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Ha, tozalansin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  CheckCircle2,
  Clock,
  BedDouble,
  Loader2,
  Pencil,
  Ban,
  Upload,
  CalendarDays,
  Layers,
  ChevronDown,
  ArrowLeft,
  Camera,
} from "lucide-react"
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  addMonths,
  subMonths,
  isSameDay,
  isWithinInterval,
  parseISO,
  isToday,
  addDays,
} from "date-fns"

import {
  useReservations,
  useCreateReservation,
  useUpdateReservation,
  useCancelReservation,
} from "../api/reservations"
import { useRooms, useRoomTypes, useFloors } from "@/features/rooms/api/rooms"
import { useHousekeepingTasks } from "@/features/housekeeping/api/housekeeping"
import {
  useGuests,
  useCreateGuest,
  uploadGuestFile,
  GUEST_PHOTO_ACCEPT,
  GUEST_PHOTO_MAX_BYTES,
} from "@/features/guests/api/guests"
import { NATIONALITIES, DEFAULT_NATIONALITY } from "@/features/guests/constants"
import { BirthDateSelect } from "@/features/guests/components/BirthDateSelect"
import { useAuthStore } from "@/store/auth"
import { usePermissions } from "@/lib/permissions"

import { HourlyBoard } from "../components/HourlyBoard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const DAY_WIDTH = 120
const ROOM_COL_WIDTH = 200
const ROW_HEIGHT = 72

const statusColors: Record<string, string> = {
  PENDING: "bg-amber-400 text-gray-900",
  CONFIRMED: "bg-blue-600 text-white",
  CHECKED_IN: "bg-emerald-600 text-white",
  CHECKED_OUT: "bg-gray-400 text-white",
  NO_SHOW: "bg-gray-500 text-white",
  CANCELLED: "bg-red-100 text-red-500 line-through",
}

const statusLabels: Record<string, string> = {
  PENDING: "Kutilmoqda",
  CONFIRMED: "Tasdiqlangan",
  CHECKED_IN: "Kirgan",
  CHECKED_OUT: "Chiqgan",
  NO_SHOW: "Kelmadi",
  CANCELLED: "Bekor qilingan",
}

const weekDays = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"]

// Xonaning MAXSUS holatlari — bronlardan ko'rinmaydigan, e'tibor talab
// qiladigan holatlar rangli belgi bilan ko'rsatiladi (Bo'sh/Band esa
// bronlarning o'zidan ma'lum bo'ladi).
const ROOM_STATUS_LABELS: Record<string, string> = {
  CLEANING: "Tozalanmoqda",
  MAINTENANCE: "Ta'mirda",
  INSPECTION: "Tekshiruvda",
  OUT_OF_SERVICE: "Xizmatdan tashqari",
}

const roomStatusBadge: Record<string, string> = {
  CLEANING: "bg-amber-100 text-amber-700",
  MAINTENANCE: "bg-orange-100 text-orange-700",
  INSPECTION: "bg-purple-100 text-purple-700",
  OUT_OF_SERVICE: "bg-gray-200 text-gray-600",
}

// Xonaga biriktirilgan FAOL xo'jalik vazifasi ham belgi sifatida ko'rsatiladi
// (vazifa yaratilishi xona holatini o'zgartirmaydi — bu alohida signal)
export const TASK_TYPE_LABELS: Record<string, string> = {
  CLEANING: "Tozalash",
  DEEP_CLEANING: "Chuqur tozalash",
  MAINTENANCE: "Ta'mirlash",
  INSPECTION: "Tekshiruv",
  TURN_DOWN: "Kechki tayyorlash",
}

export const taskTypeBadge: Record<string, string> = {
  CLEANING: "bg-amber-100 text-amber-700",
  DEEP_CLEANING: "bg-amber-100 text-amber-800",
  MAINTENANCE: "bg-orange-100 text-orange-700",
  INSPECTION: "bg-purple-100 text-purple-700",
  TURN_DOWN: "bg-sky-100 text-sky-700",
}

// Soatlik bron uchun tayyor davomiyliklar (1 dan 12 soatgacha)
const DURATION_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1)

// Soatlik bronlar orasidagi majburiy tanaffus (daqiqa) — mijoz chiqib ketgach
// xonani tayyorlash uchun. Backenddagi HOURLY_TURNOVER_MINUTES bilan bir xil
// bo'lishi kerak (masalan, 10:00-11:00 bron bo'lsa keyingisi 11:15 dan).
const HOURLY_TURNOVER_MIN = 15

// Soatlik bron narxi davomiylikka BOG'LIQ EMAS — kunlik narx to'liq olinadi
// (1 soat ham, 24 soat ham bir xil narx). Backend ham xuddi shunday hisoblaydi.

// Qisman (bo'lib) to'lovdagi qo'shimcha qatorlar uchun to'lov usullari
const PAYMENT_METHOD_OPTIONS = [
  { value: "CASH", label: "Naqd pul" },
  { value: "CREDIT_CARD", label: "Kredit karta" },
  { value: "DEBIT_CARD", label: "Debit karta" },
  { value: "BANK_TRANSFER", label: "Bank o'tkazmasi" },
  { value: "MOBILE_PAYMENT", label: "Mobil to'lov" },
  { value: "ONLINE", label: "Onlayn" },
] as const

// Passport raqami: faqat lotin bosh harflari va raqamlar.
// Bo'sh joy, tire, tinish belgilari va boshqa alifbolar olib tashlanadi.
function sanitizePassport(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function addDaysStr(dateStr: string, amount: number) {
  const d = parseISO(dateStr)
  return format(addDays(d, amount), "yyyy-MM-dd")
}

function dayDiff(startStr: string, endStr: string) {
  const start = parseISO(startStr)
  const end = parseISO(endStr)
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
}

// Backend xatosidan o'qiladigan matn tuzish (FastAPI 422 -> detail massiv bo'lishi mumkin).
function apiErrorMessage(error: any): string {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d: any) => {
        const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : ""
        return field ? `${field}: ${d.msg}` : d.msg
      })
      .join("\n")
  }
  return "Xatolik yuz berdi. Iltimos qaytadan urinib ko'ring."
}

// Vaqtni "HH:MM" ko'rinishiga normallash (ba'zi brauzerlar sekund qo'shib yuboradi:
// "14:00:00" -> "14:00"). Aks holda ISO datetime buzilib 422 xatosi keladi.
function normalizeTime(t?: string): string {
  if (!t) return "00:00"
  const [h = "00", m = "00"] = t.split(":")
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`
}

// Soatlik bron davomiyligi (soatlarda). Chiqish vaqti kirishdan kichik/teng bo'lsa
// keyingi kunga o'tadi (tunab qolish).
function hourlyDuration(inTime?: string, outTime?: string): number {
  if (!inTime || !outTime) return 0
  const [ih, im] = inTime.split(":").map(Number)
  const [oh, om] = outTime.split(":").map(Number)
  let mins = oh * 60 + om - (ih * 60 + im)
  if (mins <= 0) mins += 24 * 60
  return Math.max(1, Math.round((mins / 60) * 100) / 100)
}

// Kalendarда bron egallagan kunlarni aniqlash uchun samarali sanalar.
// Soatlik bronда backend check_out_date ni majburan check_in + 1 kun qilib saqlaydi,
// shuning uchun kun oralig'ини datetime maydonlaridan (sana qismidan) olamiz —
// aks holda 2 soatlik bron 2 kunni egallab ko'rinadi.
function resStartDate(r: any): string {
  if (r.booking_type === "HOURLY" && r.check_in_datetime) {
    return r.check_in_datetime.slice(0, 10)
  }
  return r.check_in_date
}

function resEndDate(r: any): string {
  if (r.booking_type === "HOURLY" && r.check_out_datetime) {
    return r.check_out_datetime.slice(0, 10)
  }
  return r.check_out_date
}

// Soatlik bron uchun "HH:MM" ko'rinishidagi vaqt (datetime satridan).
function resTimeRange(r: any): string {
  if (r.booking_type !== "HOURLY" || !r.check_in_datetime || !r.check_out_datetime) return ""
  return `${r.check_in_datetime.slice(11, 16)} - ${r.check_out_datetime.slice(11, 16)}`
}

// "HH:MM" -> kun boshidan o'tgan minutlar
function timeToMin(t: string): number {
  const [h = 0, m = 0] = t.split(":").map(Number)
  return h * 60 + m
}

function minToTime(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

// Berilgan xona va sana uchun band vaqt oraliqlari (minutlarda, boshlanish bo'yicha
// saralangan). Tunab qoluvchi soatlik bronlar kun chegarasida kesiladi.
// Har bir bron tugagach HOURLY_TURNOVER_MIN daqiqa tanaffus ham "band" deb
// qo'shiladi — keyingi mijoz shu vaqtdan keyin kirishi mumkin.
function busyIntervalsFor(list: any[], roomId: string, dateStr: string): Array<[number, number]> {
  const res: Array<[number, number]> = []
  for (const r of list) {
    if (r.room_id !== roomId || r.status === "CANCELLED" || r.booking_type !== "HOURLY") continue
    if (!r.check_in_datetime || !r.check_out_datetime) continue
    const ciDate = r.check_in_datetime.slice(0, 10)
    const coDate = r.check_out_datetime.slice(0, 10)
    const ciMin = timeToMin(r.check_in_datetime.slice(11, 16))
    const coMin = timeToMin(r.check_out_datetime.slice(11, 16))
    const coBuffered = Math.min(coMin + HOURLY_TURNOVER_MIN, 24 * 60)
    if (ciDate === dateStr && coDate === dateStr) res.push([ciMin, coBuffered])
    else if (ciDate === dateStr) res.push([ciMin, 24 * 60])
    else if (coDate === dateStr) res.push([0, coBuffered])
  }
  return res.sort((a, b) => a[0] - b[0])
}

// Birinchi bo'sh vaqt oralig'ini topish: avval kunduzgi (08:00 dan keyingi) slot
// afzal — 2 soatlik, bo'lmasa 1 soatlik, bo'lmasa 30 daqiqalik; kunduzi umuman
// joy bo'lmasa tungi vaqtlardan izlanadi.
function findFreeSlot(busy: Array<[number, number]>): [number, number] | null {
  for (const preferStart of [8 * 60, 0]) {
    for (const dur of [120, 60, 30]) {
      let cursor = preferStart
      let found: [number, number] | null = null
      for (const [bs, be] of busy) {
        // Keyingi bron boshlanishidan oldin bizning mijoz chiqishi uchun ham
        // tanaffus sig'ishi kerak
        if (bs - cursor >= dur + HOURLY_TURNOVER_MIN) {
          found = [cursor, cursor + dur]
          break
        }
        cursor = Math.max(cursor, be)
      }
      if (!found && 24 * 60 - cursor >= dur) found = [cursor, cursor + dur]
      if (found) return found
    }
  }
  return null
}

export function BookingPage() {
  // Sahifa tablari: "hourly" — kalendarsiz, bir kunlik soatlik bron taxtasi (birinchi),
  // "calendar" — avvalgi oylik kalendar (o'zgarishsiz).
  const [activeTab, setActiveTab] = useState<"hourly" | "calendar">("hourly")
  const [hourlyDate, setHourlyDate] = useState(() => format(new Date(), "yyyy-MM-dd"))

  // Yig'ilgan (qisqartirilgan) qavatlar — kalendar va soatlik tab uchun umumiy
  const [collapsedFloors, setCollapsedFloors] = useState<Set<string>>(new Set())
  const toggleFloor = useCallback((key: string) => {
    setCollapsedFloors((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedRoom, setSelectedRoom] = useState<any | null>(null)
  const [selectionStart, setSelectionStart] = useState<string | null>(null)
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [guestSearch, setGuestSearch] = useState("")
  const [showNewGuest, setShowNewGuest] = useState(false)

  // Fuqarolik ro'yxatda bo'lmasa ("Boshqa") — qo'lda kiritiladigan davlat nomi
  const [nationalityOther, setNationalityOther] = useState("")

  // Yangi mehmon surati (passport rasmi / mehmon fotosi)
  const [guestPhoto, setGuestPhoto] = useState<File | null>(null)
  const [guestPhotoPreview, setGuestPhotoPreview] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)

  // Tanlangan faylni tekshirib, oldindan ko'rish uchun URL tayyorlash
  const handlePhotoChange = (file: File | null) => {
    if (guestPhotoPreview) URL.revokeObjectURL(guestPhotoPreview)
    if (!file) {
      setGuestPhoto(null)
      setGuestPhotoPreview(null)
      return
    }
    if (!GUEST_PHOTO_ACCEPT.split(",").includes(file.type)) {
      setErrorDialog("Faqat JPG, PNG yoki WEBP formatdagi rasm yuklash mumkin.")
      return
    }
    if (file.size > GUEST_PHOTO_MAX_BYTES) {
      setErrorDialog("Rasm hajmi 5 MB dan oshmasligi kerak.")
      return
    }
    setGuestPhoto(file)
    setGuestPhotoPreview(URL.createObjectURL(file))
  }

  const clearGuestPhoto = () => handlePhotoChange(null)

  // --- Kamera orqali surat olish ---
  // Faylni kompyuterdan tanlash imkoniyati saqlanadi; bu qo'shimcha yo'l.
  // getUserMedia faqat xavfsiz kontekstda (https yoki localhost) ishlaydi.
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraOpen(false)
  }, [])

  const startCamera = async () => {
    setCameraError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Bu brauzer kamerani qo'llab-quvvatlamaydi. Faylni tanlang.")
      return
    }
    try {
      // Telefonda orqa kamera afzal, kompyuterda mavjud kamera ochiladi
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      })
      streamRef.current = stream
      setCameraOpen(true)
    } catch (err: any) {
      setCameraError(
        err?.name === "NotAllowedError"
          ? "Kameraga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat bering."
          : err?.name === "NotFoundError"
            ? "Kamera topilmadi."
            : "Kamerani ochib bo'lmadi. Faylni tanlashingiz mumkin."
      )
    }
  }

  // Video elementi paydo bo'lgach oqimni ulaymiz
  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => {})
    }
  }, [cameraOpen])

  // Modal yopilganda yoki komponent o'chganda kamerani albatta to'xtatamiz
  useEffect(() => {
    if (!modalOpen) stopCamera()
  }, [modalOpen, stopCamera])
  useEffect(() => () => stopCamera(), [stopCamera])

  // Videodan kadr olib, uni JPEG fayl sifatida saqlaymiz
  const capturePhoto = () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" })
        handlePhotoChange(file)
        stopCamera()
      },
      "image/jpeg",
      0.9
    )
  }

  // "Yangi mehmon" formasidan mavjud mehmonlar ro'yxatiga qaytish
  // (kiritilgan ma'lumotlar va tanlangan surat tozalanadi)
  const backToGuestList = () => {
    setShowNewGuest(false)
    setValue("new_guest_first_name", "")
    setValue("new_guest_last_name", "")
    setValue("new_guest_phone", "")
    setValue("new_guest_passport_number", "")
    setValue("new_guest_id_document_type", "")
    setValue("new_guest_id_document_number", "")
    setValue("new_guest_birth_date", "")
    setValue("new_guest_nationality", DEFAULT_NATIONALITY)
    setValue("new_guest_address", "")
    setNationalityOther("")
    clearGuestPhoto()
  }
  const [selectedGuestId, setSelectedGuestId] = useState<string>("")
  const [bookingType, setBookingType] = useState<"DAILY" | "HOURLY">("DAILY")

  // Qisman (bo'lib) to'lov: birinchi qator formadagi payment_amount/payment_method
  // maydonlarida, qo'shimcha qatorlar (masalan bir qismi naqd, qolgani karta)
  // shu ro'yxatda saqlanadi
  const [extraPayments, setExtraPayments] = useState<Array<{ amount: string; method: string }>>([])

  // Chegirma: so'mda yoki foizda. Backend foizni ustuvor oladi va jami
  // summani o'zi qayta hisoblaydi — bu yerda faqat ko'rsatish uchun
  const [discountType, setDiscountType] = useState<"AMOUNT" | "PERCENT">("AMOUNT")
  const [discountValue, setDiscountValue] = useState("")

  // Xato xabarini brauzer alert() o'rniga dialog sifatida ko'rsatish
  const [errorDialog, setErrorDialog] = useState<string | null>(null)

  // Bir kunga bir nechta bron bo'lganda ro'yxatni ko'rsatadigan dialog
  const [dayList, setDayList] = useState<{
    roomId: string
    roomNumber: string
    date: string
  } | null>(null)

  // Bronni boshqarish (ko'rish / tahrirlash / bekor qilish) modali holati
  const [manageOpen, setManageOpen] = useState(false)
  const [selectedReservation, setSelectedReservation] = useState<any | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [cancelMode, setCancelMode] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [editValues, setEditValues] = useState<any>({})

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

  const { data: roomsData = [], isLoading: roomsLoading } = useRooms()

  // Xonalarni doim barqaror tartibda (xona raqami bo'yicha) ko'rsatamiz —
  // aks holda bron bekor qilinganda API xonalarni boshqa tartibda qaytarib,
  // kalendar qatorlari joyi almashib ketadi.
  const rooms = useMemo<any[]>(
    () =>
      [...roomsData].sort((a: any, b: any) =>
        String(a.room_number).localeCompare(String(b.room_number), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      ),
    [roomsData]
  )
  const { data: floorsData = [] } = useFloors()

  // Xonalarni qavatlar bo'yicha guruhlaymiz. Qavatlar raqami bo'yicha,
  // ichidagi xonalar esa avvalgidek xona raqami bo'yicha tartiblanadi.
  // Qavati topilmagan xonalar oxirida "Boshqa xonalar" guruhida ko'rsatiladi.
  const roomGroups = useMemo(() => {
    const floorMap: Record<string, { number: number; label: string }> = {}
    for (const f of floorsData) {
      floorMap[f.id] = {
        number: f.floor_number,
        label: f.name || `${f.floor_number}-qavat`,
      }
    }

    const grouped: Record<string, any[]> = {}
    for (const room of rooms) {
      const key = room.floor_id && floorMap[room.floor_id] ? room.floor_id : "__other__"
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(room)
    }

    return Object.entries(grouped)
      .map(([key, groupRooms]) => ({
        key,
        label: floorMap[key]?.label ?? "Boshqa xonalar",
        order: floorMap[key]?.number ?? Number.MAX_SAFE_INTEGER,
        rooms: groupRooms,
      }))
      .sort((a, b) => a.order - b.order)
  }, [rooms, floorsData])

  const { data: reservations = [] } = useReservations()
  const { data: guests = [] } = useGuests()
  const { data: roomTypesData = [] } = useRoomTypes()

  // Xonalarga biriktirilgan FAOL (OPEN/IN_PROGRESS) xo'jalik vazifalari —
  // /housekeeping da vazifa yaratilsa, bu yerda xona belgisi sifatida chiqadi.
  // Kesh kaliti bir xil bo'lgani uchun vazifa o'zgarishi darhol aks etadi.
  const { data: hkTasks = [] } = useHousekeepingTasks()
  const activeTaskTypeByRoom = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of hkTasks) {
      if (t.status !== "OPEN" && t.status !== "IN_PROGRESS") continue
      // IN_PROGRESS ustuvor — jarayondagi vazifa ko'rsatiladi
      if (!m[t.room_id] || t.status === "IN_PROGRESS") m[t.room_id] = t.task_type
    }
    return m
  }, [hkTasks])
  const { user } = useAuthStore()

  // Ruxsatlar: tugma va amallar shularga qarab ko'rsatiladi
  const { can } = usePermissions()
  const canCreate = can("reservation.create")
  const canUpdate = can("reservation.update")
  const canCancel = can("reservation.cancel")
  const canCreateGuest = can("guest.create")

  const createReservationMutation = useCreateReservation()
  const createGuestMutation = useCreateGuest()
  const updateReservationMutation = useUpdateReservation()
  const cancelReservationMutation = useCancelReservation()

  // Ro'yxat dialogidagi bronlar — reservations o'zgarsa (tahrir/bekor) yangilanadi
  const dayListItems = useMemo(() => {
    if (!dayList) return []
    return reservations
      .filter(
        (r) =>
          r.room_id === dayList.roomId &&
          r.status !== "CANCELLED" &&
          r.booking_type === "HOURLY" &&
          resStartDate(r) === dayList.date
      )
      .sort((a, b) => (a.check_in_datetime || "").localeCompare(b.check_in_datetime || ""))
  }, [dayList, reservations])

  const priceMap = useMemo(() => {
    const map: Record<string, number> = {}
    for (const rt of roomTypesData) {
      map[rt.id] = rt.base_price ?? 0
    }
    return map
  }, [roomTypesData])

  const getRoomPrice = useCallback(
    (room: any): number => {
      if (room.base_price && room.base_price > 0) return room.base_price
      if (room.room_type_id && priceMap[room.room_type_id]) return priceMap[room.room_type_id]
      return 0
    },
    [priceMap]
  )

  const filteredGuests = useMemo(() => {
    let list = guests
    // Mehmonlarni tanlangan xonaning mehmonxonasi bo'yicha filtrlaymiz — aks holda
    // boshqa hoteldagi mehmonni tanlab qo'yish 404 (Guest not found) beradi.
    if (selectedRoom?.hotel_id) {
      list = list.filter((g) => g.hotel_id === selectedRoom.hotel_id)
    }
    if (!guestSearch.trim()) return list.slice(0, 20)
    const q = guestSearch.toLowerCase()
    return list
      .filter(
        (g) =>
          g.first_name?.toLowerCase().includes(q) ||
          g.last_name?.toLowerCase().includes(q) ||
          g.phone?.includes(q)
      )
      .slice(0, 20)
  }, [guests, guestSearch, selectedRoom])

  const reservationSchema = z
    .object({
      guest_id: z.string().optional(),
      room_id: z.string().min(1, "Xonani tanlash shart"),
      booking_type: z.enum(["DAILY", "HOURLY"]).default("DAILY"),
      check_in_date: z.string().min(1, "Kirish sanasi kiritilmagan"),
      check_out_date: z.string().min(1, "Chiqish sanasi kiritilmagan"),
      check_in_time: z.string().optional(),
      check_out_time: z.string().optional(),
      adults: z.coerce.number().min(1),
      children: z.coerce.number().min(0).optional(),
      notes: z.string().optional(),
      new_guest_first_name: z.string().optional(),
      new_guest_last_name: z.string().optional(),
      new_guest_phone: z.string().optional(),
      // Passport / hujjat ma'lumotlari (ixtiyoriy)
      new_guest_passport_number: z.string().optional(),
      new_guest_id_document_type: z.string().optional(),
      new_guest_id_document_number: z.string().optional(),
      new_guest_birth_date: z.string().optional(),
      new_guest_nationality: z.string().optional(),
      new_guest_address: z.string().optional(),
      payment_amount: z.coerce.number().min(0).optional(),
      payment_method: z.string().optional(),
    })
    .refine(
      (data) => {
        if (!data.guest_id && !data.new_guest_first_name) return false
        return true
      },
      { message: "Mehmonni tanlang yoki yangi mehmon ismini kiriting", path: ["guest_id"] }
    )
    .refine(
      (data) => {
        if (data.payment_amount && data.payment_amount > 0 && !data.payment_method) return false
        return true
      },
      { message: "To'lov summasi kiritilganda to'lov turini tanlash majburiy", path: ["payment_method"] }
    )
    .refine(
      (data) => {
        if (data.booking_type === "HOURLY") {
          return !!data.check_in_time && !!data.check_out_time
        }
        return true
      },
      { message: "Soatlik bron uchun kirish va chiqish vaqtini kiriting", path: ["check_in_time"] }
    )
    .refine(
      (data) =>
        !data.check_in_date || data.check_in_date >= format(new Date(), "yyyy-MM-dd"),
      { message: "O'tgan sanaga bron qilib bo'lmaydi", path: ["check_in_date"] }
    )

  type BookingForm = z.infer<typeof reservationSchema>

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<BookingForm>({
    resolver: zodResolver(reservationSchema) as any,
  })

  const roomReservations = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const r of reservations) {
      if (r.status === "CANCELLED") continue
      if (!map[r.room_id]) map[r.room_id] = []
      map[r.room_id].push(r)
    }
    return map
  }, [reservations])

  // Kun faqat KUNLIK bron bilan band hisoblanadi. Soatlik bronlar kunni to'liq
  // egallamaydi — o'sha kunning boshqa soatlariga yangi bron qilish mumkin
  // (vaqt kesishuvini backend tekshiradi).
  const isDateOccupied = useCallback(
    (roomId: string, date: Date): boolean => {
      const roomRes = roomReservations[roomId] || []
      for (const r of roomRes) {
        if (!r.check_in_date || !r.check_out_date) continue
        if (r.booking_type === "HOURLY") continue
        const checkIn = parseISO(resStartDate(r))
        const checkOut = parseISO(resEndDate(r))
        if (
          isWithinInterval(date, { start: checkIn, end: checkOut }) ||
          isSameDay(date, checkIn) ||
          isSameDay(date, checkOut)
        ) {
          return true
        }
      }
      return false
    },
    [roomReservations]
  )

  // O'tgan sanaga bron qilib bo'lmaydi (bugun mumkin)
  const todayStr = format(new Date(), "yyyy-MM-dd")
  const isPastDay = (d: Date) => format(d, "yyyy-MM-dd") < todayStr

  const handleCellClick = (room: any, date: Date) => {
    // Bron yaratish ruxsati bo'lmasa — kunlarni tanlash ham mantiqsiz
    if (!canCreate) return
    if (isPastDay(date)) return
    if (isDateOccupied(room.id, date)) return

    const dateStr = format(date, "yyyy-MM-dd")

    if (!selectedRoom || selectedRoom.id !== room.id) {
      setSelectedRoom(room)
      setSelectionStart(dateStr)
      setSelectionEnd(dateStr)
      return
    }

    if (!selectionStart) {
      setSelectionStart(dateStr)
      setSelectionEnd(dateStr)
      return
    }

    const startDate = parseISO(selectionStart)
    if (date < startDate) {
      setSelectionStart(dateStr)
      setSelectionEnd(dateStr)
      return
    }

    const rangeEnd = eachDayOfInterval({ start: startDate, end: date })
    const hasOccupied = rangeEnd.some((d) => isDateOccupied(room.id, d))
    if (hasOccupied) {
      setSelectionStart(dateStr)
      setSelectionEnd(dateStr)
      return
    }

    setSelectionEnd(dateStr)
  }

  const isInSelectionRange = (roomId: string, date: Date): boolean => {
    if (!selectedRoom || selectedRoom.id !== roomId) return false
    if (!selectionStart || !selectionEnd) return false
    const start = parseISO(selectionStart)
    const end = parseISO(selectionEnd)
    return (
      isWithinInterval(date, { start, end }) ||
      isSameDay(date, start) ||
      isSameDay(date, end)
    )
  }

  const isSelectionStartDay = (date: Date): boolean => {
    if (!selectionStart) return false
    return isSameDay(date, parseISO(selectionStart))
  }

  const isSelectionEndDay = (date: Date): boolean => {
    if (!selectionEnd) return false
    return isSameDay(date, parseISO(selectionEnd))
  }

  const getGuestName = (reservation: any): string => {
    if (reservation.guest) {
      return `${reservation.guest.first_name} ${reservation.guest.last_name || ''}`
    }
    const g = guests.find((x) => x.id === reservation.guest_id)
    return g ? `${g.first_name} ${g.last_name || ''}` : reservation.reservation_number || 'Band'
  }

  const openBookingModal = () => {
    // Tanlangan kunda soatlik bronlar bo'lsa — foydalanuvchi katta ehtimol yana
    // soat qo'shmoqchi, shuning uchun standart turni "Soatlik" qilamiz.
    const hasHourlyOnDay =
      !!selectedRoom &&
      !!selectionStart &&
      selectionStart === selectionEnd &&
      reservations.some(
        (r) =>
          r.room_id === selectedRoom.id &&
          r.status !== "CANCELLED" &&
          r.booking_type === "HOURLY" &&
          resStartDate(r) === selectionStart
      )
    const initialType: "DAILY" | "HOURLY" = hasHourlyOnDay ? "HOURLY" : "DAILY"
    // Soatlik rejimda band soatlarni chetlab, birinchi bo'sh vaqtni avtomatik tanlaymiz
    let inT = "14:00"
    let outT = "16:00"
    if (initialType === "HOURLY" && selectedRoom && selectionStart) {
      const busy = busyIntervalsFor(reservations, selectedRoom.id, selectionStart)
      const slot = findFreeSlot(busy)
      if (slot) {
        inT = minToTime(slot[0])
        outT = minToTime(slot[1])
      }
    }
    setBookingType(initialType)
    setValue("booking_type", initialType)
    setValue("room_id", selectedRoom?.id || "")
    setValue("check_in_date", selectionStart || "")
    setValue("check_out_date", selectionCheckout || "")
    setValue("check_in_time", inT)
    setValue("check_out_time", outT)
    setValue("adults", 1)
    setValue("children", 0)
    setValue("guest_id", "")
    setValue("new_guest_nationality", DEFAULT_NATIONALITY)
    // To'lov summasini umumiy narx bilan avtomatik to'ldirish
    setValue(
      "payment_amount",
      initialType === "HOURLY"
        ? getRoomPrice(selectedRoom || {})
        : totalPrice
    )
    setValue("payment_method", "CASH")
    setExtraPayments([])
    setDiscountType("AMOUNT")
    setDiscountValue("")
    setSelectedGuestId("")
    setGuestSearch("")
    setModalOpen(true)
  }

  // Soatlik taxtada bo'sh oraliq bosilganda — o'sha xona/kun/vaqt bilan
  // xuddi shu "Yangi bandlov" modalini soatlik rejimda ochamiz.
  // `dateStr` — taxtadagi ustun qaysi kunga tegishli bo'lsa o'sha kun
  // (yarim tundan keyingi ustunlarda ertangi kun keladi).
  const openHourlyModal = (
    room: any,
    startMin: number,
    endMin: number,
    dateStr: string = hourlyDate
  ) => {
    const inT = minToTime(startMin)
    const outT = minToTime(endMin)
    setSelectedRoom(room)
    setSelectionStart(dateStr)
    setSelectionEnd(dateStr)
    setBookingType("HOURLY")
    setValue("booking_type", "HOURLY")
    setValue("room_id", room.id)
    setValue("check_in_date", dateStr)
    setValue("check_out_date", addDaysStr(dateStr, 1))
    setValue("check_in_time", inT)
    setValue("check_out_time", outT)
    setValue("adults", 1)
    setValue("children", 0)
    setValue("guest_id", "")
    setValue("new_guest_nationality", DEFAULT_NATIONALITY)
    setValue(
      "payment_amount",
      getRoomPrice(room)
    )
    setValue("payment_method", "CASH")
    setExtraPayments([])
    setDiscountType("AMOUNT")
    setDiscountValue("")
    setSelectedGuestId("")
    setGuestSearch("")
    setModalOpen(true)
  }

  const onSubmit = async (values: BookingForm) => {
    // Surat yuklanmay qolsa — bron yaratilgandan keyin sababi bilan ogohlantiramiz
    let photoUploadError: string | null = null

    // Qisman (bo'lib) to'lov qatorlarini yig'amiz: birinchi qator formadan,
    // qo'shimchalari extraPayments dan. Summasi 0 bo'lgan qatorlar tashlanadi.
    // Tekshiruvlar mehmon yaratilishidan OLDIN — xato bo'lsa hech narsa saqlanmaydi.
    const paymentRows = [
      {
        amount: Number(values.payment_amount) || 0,
        payment_method: values.payment_method || "",
      },
      ...extraPayments.map((p) => ({
        amount: Number(p.amount) || 0,
        payment_method: p.method,
      })),
    ].filter((p) => p.amount > 0)

    if (paymentRows.some((p) => !p.payment_method)) {
      setErrorDialog("Har bir to'lov qatorida to'lov turini tanlang.")
      return
    }
    const paymentsTotal = paymentRows.reduce((s, p) => s + p.amount, 0)
    if (finalTotal > 0 && paymentsTotal > finalTotal) {
      setErrorDialog(
        `To'lovlar yig'indisi (${paymentsTotal.toLocaleString()} So'm) chegirma bilan hisoblangan jami narxdan (${finalTotal.toLocaleString()} So'm) oshib ketdi. Iltimos, summalarni to'g'rilang.`
      )
      return
    }

    try {
      // Bron aynan bir xona uchun — branch_id va hotel_id ni o'sha xonadan olamiz.
      // (Foydalanuvchida hotel/branch bo'lmasligi mumkin: masalan SUPER_ADMIN.)
      const chosenRoom =
        selectedRoom?.id === values.room_id
          ? selectedRoom
          : rooms.find((r) => r.id === values.room_id)
      const branchId = chosenRoom?.branch_id || user?.branch_id || ""
      const hotelId = chosenRoom?.hotel_id || user?.hotel_id || undefined

      let guestId = values.guest_id

      if (!guestId && values.new_guest_first_name) {
        const guest = await createGuestMutation.mutateAsync({
          first_name: values.new_guest_first_name,
          last_name: values.new_guest_last_name || "",
          phone: values.new_guest_phone || undefined,
          // Passport / hujjat ma'lumotlari — bo'sh maydonlar yuborilmaydi
          // Tozalash yuborishdan oldin ham kafolatlanadi (masalan brauzer
          // avtoto'ldirishi yoki nusxa-joylashtirish orqali kirgan qiymat uchun)
          passport_number: values.new_guest_passport_number
            ? sanitizePassport(values.new_guest_passport_number) || undefined
            : undefined,
          id_document_type: values.new_guest_id_document_type || undefined,
          id_document_number: values.new_guest_id_document_number || undefined,
          birth_date: values.new_guest_birth_date || undefined,
          // "Boshqa" tanlangan bo'lsa — qo'lda kiritilgan davlat nomi yuboriladi
          nationality:
            values.new_guest_nationality === "Boshqa"
              ? nationalityOther.trim() || undefined
              : values.new_guest_nationality || undefined,
          address: values.new_guest_address || undefined,
          hotelId,
        })
        guestId = guest.id

        // Surat tanlangan bo'lsa — mehmon yaratilgandan keyin yuklaymiz.
        // Yuklash muvaffaqiyatsiz bo'lsa bron yaratish to'xtatilmaydi, faqat
        // oxirida ogohlantirish ko'rsatiladi (mehmon va bron saqlanib qoladi).
        if (guestPhoto && guestId) {
          try {
            setPhotoUploading(true)
            await uploadGuestFile(guestId, guestPhoto, "photo", hotelId)
          } catch (uploadError) {
            console.error("Surat yuklashda xatolik", uploadError)
            photoUploadError = apiErrorMessage(uploadError)
          } finally {
            setPhotoUploading(false)
          }
        }
      }

      const basePayload = {
        guest_id: guestId || "",
        room_id: values.room_id,
        branch_id: branchId,
        hotelId,
        adults: values.adults,
        children: values.children || 0,
        notes: values.notes,
        // Eski maydonlar saqlanadi (backend eski klientlar bilan ham ishlaydi),
        // qisman to'lov esa payments ro'yxatida yuboriladi
        payment_amount: paymentsTotal,
        payment_method: (paymentRows[0]?.payment_method as any) || null,
        payments: paymentRows,
        // Chegirma: foiz ustuvor — backend foizdan summani o'zi hisoblaydi
        discount_percent:
          discountType === "PERCENT" ? Math.min(Math.max(rawDiscount, 0), 100) : 0,
        discount_amount:
          discountType === "AMOUNT" ? discountAmount : 0,
      }

      let payload: any
      if (values.booking_type === "HOURLY") {
        let inTime = normalizeTime(values.check_in_time)
        let outTime = normalizeTime(values.check_out_time)

        // Hozirgi vaqtdan oldingi vaqtga bron qilib bo'lmaydi: bugungi kunda
        // boshlanish o'tib ketgan bo'lsa, uni joriy vaqtga surib, tanlangan
        // davomiylikni (intervalni) aynan saqlaymiz.
        const submitNow = new Date()
        if (values.check_in_date === format(submitNow, "yyyy-MM-dd")) {
          const nowMin = submitNow.getHours() * 60 + submitNow.getMinutes()
          const s0 = timeToMin(inTime)
          if (s0 < nowMin) {
            let durMin = timeToMin(outTime) - s0
            if (durMin <= 0) durMin += 24 * 60
            inTime = minToTime(nowMin)
            outTime = minToTime((nowMin + durMin) % (24 * 60))
            setValue("check_in_time", inTime)
            setValue("check_out_time", outTime)
          }
        }

        // Chiqish vaqti kirishdan kichik/teng bo'lsa keyingi kunga o'tadi (tunab qolish).
        const overnight = outTime <= inTime
        const checkInDate = values.check_in_date
        const checkOutDate = overnight ? addDaysStr(checkInDate, 1) : checkInDate

        // Band soat bilan kesishishga yo'l qo'ymaymiz — bo'sh vaqt tanlanishi shart.
        // Yangi bron tugagach keyingi bron boshlanishigacha ham tanaffus kerak.
        const busy = busyIntervalsFor(reservations, values.room_id, checkInDate)
        const s = timeToMin(inTime)
        const eClamped = overnight ? 24 * 60 : timeToMin(outTime)
        if (busy.some(([bs, be]) => bs < eClamped + HOURLY_TURNOVER_MIN && be > s)) {
          setErrorDialog(
            `Tanlangan vaqt band soatlar bilan kesishadi. Har bir bron orasida xonani tayyorlash uchun ${HOURLY_TURNOVER_MIN} daqiqa tanaffus bo'lishi kerak. Iltimos, bo'sh vaqtni tanlang.`
          )
          return
        }

        payload = {
          ...basePayload,
          booking_type: "HOURLY",
          check_in_date: checkInDate,
          check_out_date: checkOutDate,
          check_in_datetime: `${checkInDate}T${inTime}:00`,
          check_out_datetime: `${checkOutDate}T${outTime}:00`,
        }
      } else {
        payload = {
          ...basePayload,
          booking_type: "DAILY",
          check_in_date: values.check_in_date,
          check_out_date: values.check_out_date,
        }
      }

      await createReservationMutation.mutateAsync(payload)

      setModalOpen(false)
      setSelectedRoom(null)
      setSelectionStart(null)
      setSelectionEnd(null)
      setShowNewGuest(false)
      setSelectedGuestId("")
      setBookingType("DAILY")
      clearGuestPhoto()
      setNationalityOther("")
      setExtraPayments([])
      setDiscountValue("")
      setDiscountType("AMOUNT")
      reset()

      if (photoUploadError) {
        setErrorDialog(
          `Bron va mehmon saqlandi, lekin suratni yuklab bo'lmadi: ${photoUploadError}`
        )
      }
    } catch (error: any) {
      console.error(error)
      setErrorDialog(apiErrorMessage(error))
    }
  }

  // Bron chizig'iga bosilganda boshqaruv modalini ochish
  const openManageModal = (res: any) => {
    const isHourly = res.booking_type === "HOURLY"
    setSelectedReservation(res)
    setEditValues({
      booking_type: res.booking_type || "DAILY",
      check_in_date: resStartDate(res),
      check_out_date: isHourly ? resStartDate(res) : res.check_out_date,
      check_in_time: isHourly ? (res.check_in_datetime || "").slice(11, 16) || "14:00" : "14:00",
      check_out_time: isHourly ? (res.check_out_datetime || "").slice(11, 16) || "16:00" : "16:00",
      adults: res.adults ?? 1,
      children: res.children ?? 0,
      notes: res.notes || "",
    })
    setEditMode(false)
    setCancelMode(false)
    setCancelReason("")
    setManageOpen(true)
  }

  const closeManageModal = () => {
    setManageOpen(false)
    setSelectedReservation(null)
    setEditMode(false)
    setCancelMode(false)
    setCancelReason("")
  }

  const handleUpdateReservation = async () => {
    if (!selectedReservation) return
    try {
      const ev = editValues
      const base = {
        id: selectedReservation.id,
        hotelId: selectedReservation.hotel_id || undefined,
        adults: Number(ev.adults) || 1,
        children: Number(ev.children) || 0,
        notes: ev.notes || "",
      }
      let payload: any
      if (ev.booking_type === "HOURLY") {
        const inTime = normalizeTime(ev.check_in_time)
        const outTime = normalizeTime(ev.check_out_time)
        const overnight = outTime <= inTime
        const checkInDate = ev.check_in_date
        // Chiqish vaqtining kuni (tunab qolsa keyingi kun)
        const outDatetimeDate = overnight ? addDaysStr(checkInDate, 1) : checkInDate
        // DB cheklovi (check_out_date > check_in_date) uchun sana maydonini har doim
        // +1 kun qilamiz; haqiqiy vaqt oralig'i datetime maydonlarida saqlanadi.
        const checkOutDateField = addDaysStr(checkInDate, 1)
        payload = {
          ...base,
          booking_type: "HOURLY",
          check_in_date: checkInDate,
          check_out_date: checkOutDateField,
          check_in_datetime: `${checkInDate}T${inTime}:00`,
          check_out_datetime: `${outDatetimeDate}T${outTime}:00`,
        }
      } else {
        if (ev.check_out_date <= ev.check_in_date) {
          setErrorDialog("Chiqish sanasi kirish sanasidan keyin bo'lishi kerak.")
          return
        }
        payload = {
          ...base,
          booking_type: "DAILY",
          check_in_date: ev.check_in_date,
          check_out_date: ev.check_out_date,
        }
      }
      await updateReservationMutation.mutateAsync(payload)
      closeManageModal()
    } catch (error: any) {
      console.error(error)
      setErrorDialog(apiErrorMessage(error))
    }
  }

  const handleCancelReservation = async () => {
    if (!selectedReservation) return
    try {
      await cancelReservationMutation.mutateAsync({
        id: selectedReservation.id,
        reason: cancelReason || undefined,
        hotelId: selectedReservation.hotel_id || undefined,
      })
      closeManageModal()
    } catch (error: any) {
      console.error(error)
      setErrorDialog(apiErrorMessage(error))
    }
  }

  // --- Bron chizig'ini surib (drag) boshqa kunga ko'chirish ---
  // Bosish (4px dan kam siljish) avvalgidek boshqaruv modalini ochadi;
  // surish esa bronni gorizontal ravishda kunlar bo'ylab ko'chiradi.
  const [dragRes, setDragRes] = useState<any | null>(null)
  const [dragOffset, setDragOffset] = useState(0)
  const dragStartX = useRef(0)
  const dragOffsetRef = useRef(0)
  const dragMoved = useRef(false)

  // Surib ko'chirishni tasdiqlash dialogi (window.confirm o'rniga)
  const [moveConfirm, setMoveConfirm] = useState<{
    res: any
    offset: number
    from: string
    to: string
  } | null>(null)

  const performMove = async () => {
    if (!moveConfirm) return
    const { res, offset, from } = moveConfirm
    try {
      if (res.booking_type === "HOURLY") {
        const ciDt = res.check_in_datetime || `${from}T14:00:00`
        const coDt = res.check_out_datetime || `${from}T16:00:00`
        const newCiDate = addDaysStr(ciDt.slice(0, 10), offset)
        const newCoDate = addDaysStr(coDt.slice(0, 10), offset)
        await updateReservationMutation.mutateAsync({
          id: res.id,
          hotelId: res.hotel_id || undefined,
          booking_type: "HOURLY",
          check_in_date: newCiDate,
          // DB cheklovi (check_out_date > check_in_date) uchun +1 kun
          check_out_date: addDaysStr(newCiDate, 1),
          check_in_datetime: `${newCiDate}T${ciDt.slice(11, 19) || "00:00:00"}`,
          check_out_datetime: `${newCoDate}T${coDt.slice(11, 19) || "00:00:00"}`,
        })
      } else {
        await updateReservationMutation.mutateAsync({
          id: res.id,
          hotelId: res.hotel_id || undefined,
          booking_type: res.booking_type || "DAILY",
          check_in_date: addDaysStr(res.check_in_date, offset),
          check_out_date: addDaysStr(res.check_out_date, offset),
        })
      }
      setMoveConfirm(null)
    } catch (error: any) {
      console.error(error)
      setMoveConfirm(null)
      setErrorDialog(apiErrorMessage(error))
    }
  }

  const handleBarMouseDown = (e: React.MouseEvent, res: any) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    dragStartX.current = e.clientX
    dragOffsetRef.current = 0
    dragMoved.current = false
    setDragOffset(0)
    setDragRes(res)
  }

  useEffect(() => {
    if (!dragRes) return

    // Tahrirlash ruxsati bo'lmasa surib ko'chirish ishlamaydi (bosish — ko'rish uchun qoladi)
    const locked =
      !canUpdate || ["CHECKED_OUT", "CANCELLED", "NO_SHOW"].includes(dragRes.status)

    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartX.current
      if (Math.abs(dx) > 4) dragMoved.current = true
      if (!locked) {
        const off = Math.round(dx / DAY_WIDTH)
        if (off !== dragOffsetRef.current) {
          dragOffsetRef.current = off
          setDragOffset(off)
        }
      }
    }

    const onUp = async () => {
      const res = dragRes
      const offset = dragOffsetRef.current
      setDragRes(null)
      setDragOffset(0)

      // Siljimagan bo'lsa — oddiy bosish: boshqaruv modalini ochamiz
      if (!dragMoved.current) {
        openManageModal(res)
        return
      }
      if (locked || offset === 0) return

      const fromDate = resStartDate(res)
      const toDate = addDaysStr(fromDate, offset)
      // O'tgan sanaga ko'chirishga yo'l qo'ymaymiz
      if (toDate < format(new Date(), "yyyy-MM-dd")) {
        setErrorDialog("Bronni o'tgan sanaga ko'chirib bo'lmaydi.")
        return
      }
      // Tasdiqlashni dialog orqali so'raymiz (window.confirm o'rniga)
      setMoveConfirm({ res, offset, from: fromDate, to: toDate })
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragRes])

  const clearSelection = () => {
    setSelectedRoom(null)
    setSelectionStart(null)
    setSelectionEnd(null)
  }

  // Tanlov bo'yicha chiqish sanasi: OXIRGI tanlangan kun = chiqish kuni
  // (29→30 tanlansa — 1 kecha: 29 kirish, 30 chiqish). Bitta kun tanlanganda
  // ertasi kuni chiqiladi (1 kecha). Backend ham xuddi shunday hisoblaydi:
  // nights = check_out - check_in.
  const selectionCheckout =
    selectionStart && selectionEnd
      ? selectionEnd > selectionStart
        ? selectionEnd
        : addDaysStr(selectionEnd, 1)
      : null

  const nightCount =
    selectionStart && selectionCheckout ? dayDiff(selectionStart, selectionCheckout) : 0

  const roomPrice = selectedRoom ? getRoomPrice(selectedRoom) : 0
  const totalPrice = nightCount * roomPrice

  // Soatlik bron uchun reaktiv hisob-kitob (modaldagi vaqt maydonlariga bog'liq)
  const watchInTime = watch("check_in_time")
  const watchOutTime = watch("check_out_time")
  const hourCount =
    bookingType === "HOURLY" ? hourlyDuration(watchInTime, watchOutTime) : 0

  // Yangi bandlov dialogida tanlangan sana/xona uchun band soat oraliqlari
  const watchFormDate = watch("check_in_date")
  const watchFormOutDate = watch("check_out_date")
  const watchFormRoom = watch("room_id")
  const watchNationality = watch("new_guest_nationality")
  const watchBirthDate = watch("new_guest_birth_date")
  const dialogBusyTimes = useMemo(() => {
    if (!modalOpen || bookingType !== "HOURLY") return []
    const roomId = selectedRoom?.id || watchFormRoom
    if (!roomId || !watchFormDate) return []
    return busyIntervalsFor(reservations, roomId, watchFormDate)
  }, [modalOpen, bookingType, selectedRoom, watchFormRoom, watchFormDate, reservations])

  // Tanlangan vaqt band oraliqlar bilan kesishadimi (dialogda ogohlantirish uchun).
  // Yangi bron tugagach ham tanaffus qoldiriladi.
  const selectedTimeConflict = useMemo(() => {
    if (bookingType !== "HOURLY" || !watchInTime || !watchOutTime) return false
    const s = timeToMin(normalizeTime(watchInTime))
    const e = timeToMin(normalizeTime(watchOutTime))
    const eClamped = e <= s ? 24 * 60 : e + HOURLY_TURNOVER_MIN // tunab qolsa kun oxirigacha
    return dialogBusyTimes.some(([bs, be]) => bs < eClamped && be > s)
  }, [bookingType, watchInTime, watchOutTime, dialogBusyTimes])

  // --- Dialogdagi vaqtni real vaqtda yangilab turish ---
  // Dialog ochiq turganda daqiqalar o'tsa, bugungi soatlik bronning kirish
  // vaqti o'tmishda qolib ketmasligi kerak: boshlanish joriy vaqtga suriladi,
  // tanlangan davomiylik (interval) esa aynan saqlanadi.
  const [nowTick, setNowTick] = useState(() => new Date())
  useEffect(() => {
    if (!modalOpen) return
    const id = setInterval(() => setNowTick(new Date()), 10_000)
    return () => clearInterval(id)
  }, [modalOpen])

  useEffect(() => {
    if (!modalOpen || bookingType !== "HOURLY") return
    if (watchFormDate !== format(nowTick, "yyyy-MM-dd")) return // faqat bugungi kun
    if (!watchInTime || !watchOutTime) return
    const nowMin = nowTick.getHours() * 60 + nowTick.getMinutes()
    const s = timeToMin(normalizeTime(watchInTime))
    if (s >= nowMin) return // boshlanish hali kelmagan — tegmaymiz
    // Davomiylikni saqlab, boshlanishni joriy vaqtga suramiz
    let durMin = timeToMin(normalizeTime(watchOutTime)) - s
    if (durMin <= 0) durMin += 24 * 60
    setValue("check_in_time", minToTime(nowMin))
    setValue("check_out_time", minToTime((nowMin + durMin) % (24 * 60)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, bookingType, nowTick, watchFormDate, watchInTime, watchOutTime])
  // --- Dialogdagi JONLI hisob-kitob (kunlik) ---
  // Forma sanalari o'zgarsa kecha soni va narx darhol qayta hisoblanadi.
  // Xona kalendar tanlovidan yoki dialogdagi selectdan kelishi mumkin.
  const dialogRoom =
    selectedRoom || rooms.find((r) => r.id === watchFormRoom) || null
  const dialogRoomPrice = dialogRoom ? getRoomPrice(dialogRoom) : 0
  const dialogNightCount =
    watchFormDate && watchFormOutDate
      ? Math.max(dayDiff(watchFormDate, watchFormOutDate), 0)
      : nightCount
  const dialogDailyTotal = dialogNightCount * dialogRoomPrice
  // Soatlik jami ham dialogdagi xona narxidan jonli hisoblanadi
  const hourlyTotal = dialogRoomPrice

  const effectiveTotal = bookingType === "HOURLY" ? hourlyTotal : dialogDailyTotal

  // Chegirma hisobi — backend bilan bir xil mantiq: foizda bo'lsa butun
  // so'mga yaxlitlanadi, summada bo'lsa jami narxdan oshmaydi
  const rawDiscount = Number(discountValue) || 0
  const discountAmount =
    discountType === "PERCENT"
      ? Math.round((effectiveTotal * Math.min(Math.max(rawDiscount, 0), 100)) / 100)
      : Math.min(Math.max(rawDiscount, 0), effectiveTotal)
  // Mijoz to'laydigan yakuniy summa (chegirma bilan)
  const finalTotal = Math.max(effectiveTotal - discountAmount, 0)

  // Sana/vaqt/xona/chegirma o'zgarganda to'lov summasi yangi jamiga moslanadi —
  // kunlikda ham, soatlikda ham (chiqish vaqti QO'LDA o'zgartirilganda ham).
  // Vaqtni real-vaqtga surish davomiylikni saqlagani uchun bunda summa
  // o'zgarmaydi; foydalanuvchi kiritgan qisman summa ham jami o'zgarmaguncha
  // saqlanadi.
  useEffect(() => {
    if (!modalOpen) return
    setValue("payment_amount", finalTotal)
    setExtraPayments([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, bookingType, finalTotal])

  // --- Qisman (bo'lib) to'lov hisob-kitobi ---
  // Barcha qatorlar (birinchi + qo'shimchalar) yig'indisi va qolgan summa
  const watchPaymentAmount = watch("payment_amount")
  const paidTotal =
    (Number(watchPaymentAmount) || 0) +
    extraPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const remainingAmount = Math.max(finalTotal - paidTotal, 0)

  // Yangi qator qolgan summa bilan ochiladi — usulni foydalanuvchi tanlaydi
  const addExtraPayment = () => {
    setExtraPayments((prev) => [
      ...prev,
      { amount: remainingAmount > 0 ? String(remainingAmount) : "", method: "" },
    ])
  }

  const updateExtraPayment = (
    index: number,
    patch: Partial<{ amount: string; method: string }>
  ) => {
    setExtraPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  const removeExtraPayment = (index: number) => {
    setExtraPayments((prev) => prev.filter((_, i) => i !== index))
  }

  // --- Soatlik bronda davomiylikni tugma bilan tanlash ---
  // Tanlangan soat kirish vaqtiga qo'shilib, chiqish vaqti avtomatik hisoblanadi.
  // Chiqish vaqtini qo'lda kiritish imkoniyati o'zgarishsiz qoladi.
  const applyDuration = (hours: number) => {
    const inT = normalizeTime(watchInTime || "14:00")
    const outMin = (timeToMin(inT) + hours * 60) % (24 * 60)
    const outT = minToTime(outMin)
    setValue("check_in_time", inT)
    setValue("check_out_time", outT)
    setValue("payment_amount", roomPrice)
    // Summa qayta hisoblandi — qo'shimcha to'lov qatorlari eskirdi
    setExtraPayments([])
  }

  // Tanlangan davomiylik band soatlar bilan kesishadimi (tugmani belgilash uchun).
  // Bron tugagach keyingi bron oldidan tanaffus ham hisobga olinadi.
  const durationConflicts = (hours: number): boolean => {
    if (!watchInTime) return false
    const s = timeToMin(normalizeTime(watchInTime))
    const e = s + hours * 60 + HOURLY_TURNOVER_MIN
    const eClamped = Math.min(e, 24 * 60) // tunab qolsa kun oxirigacha tekshiramiz
    return dialogBusyTimes.some(([bs, be]) => bs < eClamped && be > s)
  }

  const calendarWidth = days.length * DAY_WIDTH

  return (
    // Layout booking sahifasini "full bleed" qilib beradi (padding/max-width yo'q),
    // shuning uchun bu yerda h-full bilan mavjud balandlikni to'liq egallaymiz.
    <div className="flex flex-col h-full w-full min-w-0">
      {/* Tablar: Soatlik bron / Kalendar — ixcham segment (pill) ko'rinishida */}
      <div className="flex-shrink-0 flex items-center px-6 py-2.5 bg-white border-b border-gray-200">
        <div className="flex rounded-lg bg-gray-100 p-1">
          {([
            { key: "hourly", label: "Soatlik bron", icon: Clock },
            { key: "calendar", label: "Kalendar", icon: CalendarDays },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
                activeTab === tab.key
                  ? "bg-white text-primary-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "hourly" ? (
        <HourlyBoard
          date={hourlyDate}
          onDateChange={setHourlyDate}
          roomGroups={roomGroups}
          collapsedFloors={collapsedFloors}
          onToggleFloor={toggleFloor}
          reservations={reservations}
          onSlotClick={openHourlyModal}
          onReservationClick={openManageModal}
          canCreate={canCreate}
          getRoomPrice={getRoomPrice}
          getGuestName={getGuestName}
          statusColors={statusColors}
          activeTaskTypeByRoom={activeTaskTypeByRoom}
        />
      ) : (
      <>
      {/* Top bar — oy navigatsiyasi chapda; o'ngda tanlov xulosasi yoki
          (tanlov yo'q payt) ixcham legenda. Alohida legenda qatori olib
          tashlandi — sahifa bir qatorga ixchamlashdi. */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-2.5 bg-white border-b border-gray-200">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            title="Oldingi oy"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-[15px] font-bold text-gray-900 min-w-[150px] text-center">
            {format(currentMonth, "MMMM yyyy")}
          </h3>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            title="Keyingi oy"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-1 text-primary-700"
            onClick={() => setCurrentMonth(new Date())}
          >
            Bugun
          </Button>
        </div>

        <div className="flex items-center gap-3">
          {selectedRoom && selectionStart && selectionEnd ? (
            <div className="flex items-center gap-2 text-sm text-primary-900 bg-primary-50 border border-primary-100 rounded-lg px-3 py-1.5">
              <span className="font-semibold">{selectedRoom.room_number}</span>
              <span className="text-primary-300">·</span>
              <span>{selectionStart} → {selectionCheckout}</span>
              <span className="text-primary-300">·</span>
              <span>{nightCount} kecha</span>
              <span className="text-primary-300">·</span>
              <span className="font-semibold text-primary-700">{totalPrice.toLocaleString()} So'm</span>
              <button
                onClick={clearSelection}
                title="Tanlovni bekor qilish"
                className="ml-1 p-0.5 rounded hover:bg-primary-100 text-primary-400 hover:text-primary-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-3.5 text-[11px] text-gray-500">
              {(
                [
                  ["bg-blue-600", "Tasdiqlangan"],
                  ["bg-emerald-600", "Kirgan"],
                  ["bg-amber-400", "Kutilmoqda"],
                  ["bg-primary-200 border border-primary-300", "Tanlangan"],
                  ["bg-gray-400", "Chiqgan"],
                ] as const
              ).map(([color, label]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className={cn("h-2.5 w-2.5 rounded-full", color)} />
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Calendar */}
      <div className="flex-1 overflow-auto bg-gray-50">
        {roomsLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="min-w-max h-full">
            {/* Header row */}
            <div className="sticky top-0 z-30 flex bg-white border-b border-gray-200 shadow-sm">
              <div
                className="flex-shrink-0 h-14 flex items-center px-4 bg-gray-50 border-r border-gray-200 sticky left-0 z-40"
                style={{ width: ROOM_COL_WIDTH }}
              >
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Xonalar
                </span>
              </div>
              <div className="flex" style={{ width: calendarWidth }}>
                {days.map((day) => {
                  const weekend = day.getDay() === 0 || day.getDay() === 6
                  const today = isToday(day)
                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        "flex-shrink-0 border-r border-gray-200 flex flex-col items-center justify-center h-14",
                        today && "bg-primary-50",
                        weekend && !today && "bg-gray-50"
                      )}
                      style={{ width: DAY_WIDTH }}
                    >
                      <span
                        className={cn(
                          "text-xs font-medium",
                          today ? "text-primary-700" : weekend ? "text-red-400" : "text-gray-400"
                        )}
                      >
                        {weekDays[(day.getDay() + 6) % 7]}
                      </span>
                      <span
                        className={cn(
                          "text-lg font-bold",
                          today ? "text-primary-700" : weekend ? "text-red-500" : "text-gray-900"
                        )}
                      >
                        {format(day, "dd")}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Room rows — qavatlar bo'yicha guruhlangan */}
            <div>
              {roomGroups.map((group) => {
                const collapsed = collapsedFloors.has(group.key)
                return (
                <div key={group.key}>
                  {/* Qavat sarlavhasi — bosilsa qavat yig'iladi/ochiladi */}
                  <div
                    className="flex bg-gray-100 border-y border-gray-200 cursor-pointer hover:bg-gray-200/70 transition-colors"
                    onClick={() => toggleFloor(group.key)}
                    title={collapsed ? "Qavatni ochish" : "Qavatni yig'ish"}
                  >
                    <div
                      className="flex-shrink-0 flex items-center gap-2 px-4 h-9 bg-gray-100 border-r border-gray-200 sticky left-0 z-20"
                      style={{ width: ROOM_COL_WIDTH }}
                    >
                      {collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
                      )}
                      <Layers className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-xs font-bold text-gray-600 uppercase tracking-wider truncate">
                        {group.label}
                      </span>
                      <span className="text-[10px] text-gray-400">({group.rooms.length})</span>
                    </div>
                    <div className="h-9" style={{ width: calendarWidth }} />
                  </div>

                  {!collapsed && group.rooms.map((room: any) => (
                <div
                  key={room.id}
                  className="flex border-b border-gray-100 bg-white hover:bg-gray-50/50 transition-colors"
                  style={{ height: ROW_HEIGHT }}
                >
                  {/* Room info - sticky left */}
                  <div
                    className="flex-shrink-0 flex flex-col justify-center px-4 bg-white border-r border-gray-200 sticky left-0 z-20"
                    style={{ width: ROOM_COL_WIDTH }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-gray-900">
                        {room.room_number}
                      </span>
                      {/* Xonaning maxsus holati (tozalanmoqda/ta'mirda/...) */}
                      {ROOM_STATUS_LABELS[room.current_status] && (
                        <span
                          className={cn(
                            "text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap",
                            roomStatusBadge[room.current_status]
                          )}
                        >
                          {ROOM_STATUS_LABELS[room.current_status]}
                        </span>
                      )}
                      {/* Faol xo'jalik vazifasi (holat belgisi bo'lmasa) */}
                      {!ROOM_STATUS_LABELS[room.current_status] &&
                        activeTaskTypeByRoom[room.id] && (
                          <span
                            title="Xonaga xo'jalik vazifasi biriktirilgan"
                            className={cn(
                              "text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap",
                              taskTypeBadge[activeTaskTypeByRoom[room.id]]
                            )}
                          >
                            {TASK_TYPE_LABELS[activeTaskTypeByRoom[room.id]] ||
                              activeTaskTypeByRoom[room.id]}
                          </span>
                        )}
                    </div>
                    <span className="text-xs text-gray-400 truncate">
                      {room.room_type?.name || "Standard"}
                    </span>
                    {getRoomPrice(room) > 0 && (
                      <span className="text-[10px] text-primary-600 font-medium">
                        {getRoomPrice(room).toLocaleString()} So'm
                      </span>
                    )}
                  </div>

                  {/* Day cells */}
                  <div
                    className="flex relative"
                    style={{ width: calendarWidth }}
                  >
                    {/* Grid lines */}
                    {days.map((day) => (
                      <div
                        key={day.toISOString()}
                        className={cn(
                          "flex-shrink-0 border-r border-gray-50 h-full",
                          canCreate && !isPastDay(day) ? "cursor-pointer" : "cursor-default",
                          isPastDay(day) && "bg-gray-100/60",
                          isToday(day) && "bg-primary-50/30",
                          isInSelectionRange(room.id, day) && "bg-primary-100/70"
                        )}
                        style={{ width: DAY_WIDTH }}
                        onClick={() => handleCellClick(room, day)}
                      />
                    ))}

                    {/* Booking bars */}
                    {reservations
                      .filter(
                        (r) =>
                          r.room_id === room.id && r.status !== "CANCELLED" && r.check_in_date && r.check_out_date
                      )
                      .map((res) => {
                        const checkIn = parseISO(resStartDate(res))
                        const checkOut = parseISO(resEndDate(res))
                        const startDayIdx = days.findIndex((d) =>
                          isSameDay(d, checkIn)
                        )
                        const endDayIdx = days.findIndex((d) =>
                          isSameDay(d, checkOut)
                        )
                        if (startDayIdx === -1 && endDayIdx === -1) return null

                        const left =
                          startDayIdx >= 0
                            ? startDayIdx * DAY_WIDTH + 4
                            : 4
                        const width =
                          startDayIdx >= 0 && endDayIdx >= 0
                            ? (endDayIdx - startDayIdx + 1) * DAY_WIDTH - 8
                            : startDayIdx >= 0
                              ? (days.length - startDayIdx) * DAY_WIDTH - 8
                              : endDayIdx >= 0
                                ? (endDayIdx + 1) * DAY_WIDTH - 8
                                : calendarWidth - 8

                        const colorClass =
                          statusColors[res.status] || statusColors.PENDING

                        // Bir kunda bir nechta soatlik bron bo'lsa — ingichka chiziqlar
                        // o'rniga bitta "N ta bron" belgisi ko'rsatamiz (bosilsa ro'yxat).
                        if (res.booking_type === "HOURLY") {
                          const sameDay = reservations
                            .filter(
                              (r) =>
                                r.room_id === room.id &&
                                r.status !== "CANCELLED" &&
                                r.booking_type === "HOURLY" &&
                                resStartDate(r) === resStartDate(res)
                            )
                            .sort((a, b) =>
                              (a.check_in_datetime || "").localeCompare(b.check_in_datetime || "")
                            )
                          if (sameDay.length > 1 && startDayIdx >= 0) {
                            // Faqat guruhning birinchi a'zosi belgini chizadi
                            if (sameDay[0].id !== res.id) return null
                            return (
                              <div
                                key={res.id}
                                className="absolute top-2 h-12 rounded-xl shadow-sm flex items-center justify-center gap-2 z-10 select-none cursor-pointer bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-[1.02] transition-all"
                                style={{
                                  left: startDayIdx * DAY_WIDTH + 4,
                                  width: DAY_WIDTH - 8,
                                }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDayList({
                                    roomId: room.id,
                                    roomNumber: room.room_number,
                                    date: resStartDate(res),
                                  })
                                }}
                                title="Bronlar ro'yxatini ko'rish"
                              >
                                <Clock className="h-4 w-4 flex-shrink-0" />
                                <span className="text-sm font-bold">
                                  {sameDay.length} ta bron
                                </span>
                              </div>
                            )
                          }
                        }

                        return (
                          <div
                            key={res.id}
                            className={cn(
                              "absolute top-2 h-12 rounded-xl shadow-sm flex items-center px-3 gap-2 z-10 select-none",
                              dragRes?.id === res.id
                                ? "cursor-grabbing z-30 ring-2 ring-primary-400 shadow-lg opacity-90"
                                : "cursor-pointer hover:scale-[1.01] transition-transform",
                              colorClass
                            )}
                            style={{
                              left,
                              width,
                              transform:
                                dragRes?.id === res.id && dragOffset !== 0
                                  ? `translateX(${dragOffset * DAY_WIDTH}px)`
                                  : undefined,
                            }}
                            onMouseDown={(e) => handleBarMouseDown(e, res)}
                            title="Bosish: boshqarish · Surish: boshqa kunga ko'chirish"
                          >
                            {res.status === "CONFIRMED" || res.status === "CHECKED_IN" ? (
                              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                            ) : res.status === "PENDING" ? (
                              <Clock className="h-4 w-4 flex-shrink-0" />
                            ) : (
                              <BedDouble className="h-4 w-4 flex-shrink-0" />
                            )}
                            <div className="overflow-hidden min-w-0">
                              <p className="text-sm font-semibold truncate">
                                {getGuestName(res)}
                              </p>
                              <p className="text-[10px] opacity-80 truncate">
                                {res.booking_type === "HOURLY"
                                  ? `${resStartDate(res)} · ${resTimeRange(res)}`
                                  : `${res.check_in_date} → ${res.check_out_date}`}
                              </p>
                            </div>
                          </div>
                        )
                      })}

                    {/* Selection indicator */}
                    {selectedRoom?.id === room.id &&
                      selectionStart &&
                      selectionEnd &&
                      days.map((day) => {
                        if (!isInSelectionRange(room.id, day)) return null
                        const start = isSelectionStartDay(day)
                        const end = isSelectionEndDay(day)
                        const idx = days.findIndex((d) => isSameDay(d, day))
                        return (
                          <div
                            key={`sel-${day.toISOString()}`}
                            className={cn(
                              "absolute top-2 h-12 z-10 flex items-center justify-center text-[11px] font-bold pointer-events-none",
                              start && end
                                ? "bg-primary-500 text-white rounded-xl"
                                : start
                                  ? "bg-primary-500 text-white rounded-l-xl"
                                  : end
                                    ? "bg-primary-500 text-white rounded-r-xl"
                                    : "bg-primary-200/80 text-primary-800"
                            )}
                            style={{
                              left: idx * DAY_WIDTH + (start ? 4 : 0),
                              width:
                                start && end
                                  ? DAY_WIDTH - 8
                                  : start
                                    ? DAY_WIDTH - 4
                                    : end
                                      ? DAY_WIDTH - 4
                                      : DAY_WIDTH,
                            }}
                          >
                            {start && end ? "Kirish - Chiqish" : start ? "Kirish" : end ? "Chiqish" : ""}
                          </div>
                        )
                      })}
                  </div>
                </div>
                  ))}
                </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-3 bg-white border-t border-gray-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <div className="text-sm text-gray-500">
          {rooms.length} xonalar · {format(currentMonth, "MMMM yyyy")}
        </div>
        <div className="flex items-center gap-3">
          {canCreate ? (
            <>
              <Button variant="secondary" onClick={clearSelection} disabled={!selectedRoom}>
                Bekor qilish
              </Button>
              <Button
                onClick={openBookingModal}
                disabled={!selectedRoom || !selectionStart || !selectionEnd}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Tasdiqlash
              </Button>
            </>
          ) : (
            <span className="text-xs text-gray-400">
              Yangi bron yaratish uchun ruxsatingiz yo'q
            </span>
          )}
        </div>
      </div>
      </>
      )}

      {/* Booking Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-[640px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Yangi bandlov</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-4 py-4">
            {/* Bron turi: Kunlik / Soatlik */}
            <div className="flex rounded-lg bg-gray-100 p-1">
              {([
                { key: "DAILY", label: "Kunlik" },
                { key: "HOURLY", label: "Soatlik" },
              ] as const).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => {
                    setBookingType(opt.key)
                    setValue("booking_type", opt.key)
                    if (opt.key === "HOURLY") {
                      // Band soatlarni chetlab birinchi bo'sh vaqtni avtomatik tanlaymiz
                      const roomId = selectedRoom?.id || watchFormRoom
                      const dateStr = watchFormDate || selectionStart || ""
                      const busy =
                        roomId && dateStr ? busyIntervalsFor(reservations, roomId, dateStr) : []
                      const slot = findFreeSlot(busy)
                      const inT = slot ? minToTime(slot[0]) : "14:00"
                      const outT = slot ? minToTime(slot[1]) : "16:00"
                      setValue("check_in_time", inT)
                      setValue("check_out_time", outT)
                      setValue(
                        "payment_amount",
                        roomPrice
                      )
                    } else {
                      setValue("payment_amount", totalPrice)
                    }
                    // To'lov summasi qayta hisoblanganda qo'shimcha to'lov
                    // qatorlari eskirib qoladi — tozalaymiz
                    setExtraPayments([])
                  }}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    bookingType === opt.key
                      ? "bg-white text-primary-700 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {selectedRoom ? (
              <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-lg">
                <BedDouble className="h-5 w-5 text-primary-600" />
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {selectedRoom.room_number}
                  </p>
                  {bookingType === "HOURLY" ? (
                    <p className="text-xs text-gray-500">
                      Soatlik bron{hourCount > 0 ? ` (${hourCount} soat)` : ""}
                    </p>
                  ) : (
                    watchFormDate && watchFormOutDate && (
                      <p className="text-xs text-gray-500">
                        {watchFormDate} → {watchFormOutDate} ({dialogNightCount} kecha)
                      </p>
                    )
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-sm font-medium">Xona *</label>
                <select
                  className="w-full flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  {...register("room_id")}
                >
                  <option value="">Xonani tanlang</option>
                  {rooms.map(r => (
                    <option key={r.id} value={r.id}>{r.room_number} ({r.room_type?.name}) - {getRoomPrice(r)} So'm</option>
                  ))}
                </select>
                {errors.room_id && <p className="text-xs text-red-500">{errors.room_id.message}</p>}
              </div>
            )}

            {bookingType === "HOURLY" ? (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Sana *</label>
                  <Input type="date" min={todayStr} {...register("check_in_date")} />
                  {errors.check_in_date && <p className="text-xs text-red-500">{errors.check_in_date.message}</p>}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Kirish vaqti *</label>
                  <Input type="time" {...register("check_in_time")} />
                  {errors.check_in_time && <p className="text-xs text-red-500">{errors.check_in_time.message}</p>}
                  {watchFormDate === todayStr && (
                    <p className="text-[11px] text-gray-400">
                      Vaqt o'tsa, kirish vaqti avtomatik joriy vaqtga suriladi —
                      tanlangan davomiylik saqlanadi
                    </p>
                  )}
                </div>

                {/* Davomiylikni tanlash — bir bosishda chiqish vaqti hisoblanadi */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Necha soat?</label>
                  <div className="grid grid-cols-6 gap-1.5">
                    {DURATION_OPTIONS.map((h) => {
                      const conflict = durationConflicts(h)
                      const active = Math.abs(hourCount - h) < 0.01
                      return (
                        <button
                          key={h}
                          type="button"
                          onClick={() => applyDuration(h)}
                          className={cn(
                            "h-9 rounded-md text-sm font-semibold border transition-colors",
                            active
                              ? "bg-primary-600 text-white border-primary-600"
                              : conflict
                                ? "border-red-100 bg-red-50 text-red-300 hover:border-red-200"
                                : "border-gray-200 text-gray-700 hover:bg-gray-50"
                          )}
                          title={
                            conflict
                              ? "Bu davomiylik band soatlar bilan kesishadi"
                              : `${h} soat`
                          }
                        >
                          {h}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Tugmani bosing yoki chiqish vaqtini qo'lda kiriting
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Chiqish vaqti *</label>
                  <Input type="time" {...register("check_out_time")} />
                </div>
                {dialogBusyTimes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-gray-500">Band soatlar:</span>
                    {dialogBusyTimes.map(([s, e], i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-100 font-medium"
                      >
                        {minToTime(s)} - {minToTime(e)}
                      </span>
                    ))}
                  </div>
                )}
                {selectedTimeConflict && (
                  <p className="text-xs text-red-500 font-medium">
                    Tanlangan vaqt band soatlar bilan kesishadi. Iltimos, bo'sh vaqtni tanlang.
                  </p>
                )}
              </>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Kirish sanasi *</label>
                  <Input type="date" min={todayStr} {...register("check_in_date")} />
                  {errors.check_in_date && <p className="text-xs text-red-500">{errors.check_in_date.message}</p>}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Chiqish sanasi *</label>
                  <Input type="date" min={todayStr} {...register("check_out_date")} />
                  {errors.check_out_date && <p className="text-xs text-red-500">{errors.check_out_date.message}</p>}
                </div>
              </div>
            )}

            {/* Guest selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Mehmon *
              </label>

              {!showNewGuest ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="Mijozni qidirish..."
                      value={guestSearch}
                      onChange={(e) => setGuestSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
                    {filteredGuests.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors",
                          selectedGuestId === g.id && "bg-primary-50 text-primary-700"
                        )}
                        onClick={() => {
                          setValue("guest_id", g.id)
                          setSelectedGuestId(g.id)
                          setGuestSearch("")
                        }}
                      >
                        <span className="font-medium">
                          {g.first_name} {g.last_name}
                        </span>
                        {g.phone && (
                          <span className="text-gray-400 ml-2">{g.phone}</span>
                        )}
                      </button>
                    ))}
                    {filteredGuests.length === 0 && (
                      <p className="px-3 py-4 text-sm text-gray-400 text-center">
                        Mijoz topilmadi
                      </p>
                    )}
                  </div>
                  {canCreateGuest && (
                    <button
                      type="button"
                      className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                      onClick={() => {
                        // Fuqarolik standart holda O'zbekiston bo'lib turadi
                        setValue("new_guest_nationality", DEFAULT_NATIONALITY)
                        setShowNewGuest(true)
                      }}
                    >
                      + Yangi mijoz qo'shish
                    </button>
                  )}
                  {errors.guest_id && <p className="text-xs text-red-500">{errors.guest_id.message}</p>}
                </div>
              ) : (
                <div className="space-y-3 p-3 bg-gray-50 rounded-lg border">
                  {/* Blok sarlavhasi + ro'yxatga qaytish tugmasi (forma uzun bo'lgani
                      uchun qaytish tugmasi tepada ham, pastda ham mavjud) */}
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-gray-200">
                    <span className="text-sm font-semibold text-gray-900">Yangi mehmon</span>
                    <button
                      type="button"
                      onClick={backToGuestList}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 transition-colors"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Ro'yxatga qaytish
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Ism *</label>
                      <Input placeholder="Ism" {...register("new_guest_first_name")} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Familiya</label>
                      <Input placeholder="Familiya" {...register("new_guest_last_name")} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Telefon</label>
                    <Input placeholder="Telefon" {...register("new_guest_phone")} />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium">Tug'ilgan sana</label>
                    {/* Maydon RHF'da ro'yxatdan o'tgan bo'lishi uchun yashirin input */}
                    <input type="hidden" {...register("new_guest_birth_date")} />
                    <BirthDateSelect
                      value={watchBirthDate}
                      onChange={(v) =>
                        setValue("new_guest_birth_date", v, { shouldDirty: true })
                      }
                    />
                  </div>

                  {/* Passport / hujjat ma'lumotlari */}
                  <div className="pt-2 border-t border-gray-200 space-y-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Hujjat ma'lumotlari
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Passport raqami</label>
                        <Input
                          placeholder="AA1234567"
                          autoCapitalize="characters"
                          {...register("new_guest_passport_number", {
                            // Harflar doim bosh harfda; bo'sh joy, tire va boshqa
                            // belgilar qabul qilinmaydi — faqat A-Z va 0-9
                            onChange: (e) =>
                              setValue(
                                "new_guest_passport_number",
                                sanitizePassport(e.target.value)
                              ),
                          })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Fuqaroligi</label>
                        <select
                          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                          {...register("new_guest_nationality")}
                        >
                          {NATIONALITIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        {/* "Boshqa" tanlansa — davlat nomini qo'lda kiritish */}
                        {watchNationality === "Boshqa" && (
                          <Input
                            className="mt-1.5"
                            placeholder="Davlat nomini yozing"
                            value={nationalityOther}
                            onChange={(e) => setNationalityOther(e.target.value)}
                          />
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Hujjat turi</label>
                        <select
                          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                          {...register("new_guest_id_document_type")}
                        >
                          <option value="">Tanlang</option>
                          <option value="PASSPORT">Passport</option>
                          <option value="ID_CARD">ID karta</option>
                          <option value="DRIVER_LICENSE">Haydovchilik guvohnomasi</option>
                          <option value="BIRTH_CERTIFICATE">Tug'ilganlik guvohnomasi</option>
                          <option value="OTHER">Boshqa</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Hujjat raqami</label>
                        <Input placeholder="Hujjat raqami" {...register("new_guest_id_document_number")} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Manzil</label>
                      <Input placeholder="Yashash manzili" {...register("new_guest_address")} />
                    </div>
                  </div>

                  {/* Mehmon surati / passport nusxasi */}
                  <div className="pt-2 border-t border-gray-200 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Surat (ixtiyoriy)
                    </p>
                    {guestPhotoPreview ? (
                      <div className="flex items-center gap-3">
                        <img
                          src={guestPhotoPreview}
                          alt="Mehmon surati"
                          className="h-20 w-20 rounded-lg object-cover border border-gray-200"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-gray-600 truncate">{guestPhoto?.name}</p>
                          <p className="text-[11px] text-gray-400">
                            {guestPhoto ? Math.round(guestPhoto.size / 1024) : 0} KB
                          </p>
                          <button
                            type="button"
                            className="mt-1 text-xs text-red-600 hover:text-red-700 font-medium"
                            onClick={clearGuestPhoto}
                          >
                            O'chirish
                          </button>
                        </div>
                      </div>
                    ) : cameraOpen ? (
                      /* Kamera rejimi: jonli ko'rinish + kadr olish */
                      <div className="space-y-2">
                        <video
                          ref={videoRef}
                          playsInline
                          muted
                          className="w-full h-44 object-cover rounded-lg bg-black"
                        />
                        <div className="flex items-center gap-2">
                          <Button type="button" size="sm" onClick={capturePhoto}>
                            <Camera className="h-4 w-4 mr-2" />
                            Suratga olish
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={stopCamera}>
                            Bekor qilish
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col items-center justify-center gap-1 h-24 rounded-lg border-2 border-dashed border-gray-300 cursor-pointer hover:border-primary-400 hover:bg-white transition-colors">
                          <Upload className="h-5 w-5 text-gray-400" />
                          <span className="text-xs text-gray-600 font-medium">Fayl tanlash</span>
                          <span className="text-[11px] text-gray-400">JPG, PNG, WEBP · 5 MB</span>
                          <input
                            type="file"
                            accept={GUEST_PHOTO_ACCEPT}
                            className="hidden"
                            onChange={(e) => handlePhotoChange(e.target.files?.[0] || null)}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={startCamera}
                          className="flex flex-col items-center justify-center gap-1 h-24 rounded-lg border-2 border-dashed border-gray-300 hover:border-primary-400 hover:bg-white transition-colors"
                        >
                          <Camera className="h-5 w-5 text-gray-400" />
                          <span className="text-xs text-gray-600 font-medium">Kamera</span>
                          <span className="text-[11px] text-gray-400">Hoziroq suratga olish</span>
                        </button>
                      </div>
                    )}
                    {cameraError && <p className="text-xs text-red-500">{cameraError}</p>}
                  </div>

                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 font-medium"
                    onClick={backToGuestList}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Mehmonlar ro'yxatiga qaytish
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Mehmonlar soni</label>
              <Input type="number" min="1" {...register("adults")} />
              {errors.adults && <p className="text-xs text-red-500">{errors.adults.message}</p>}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Qo'shimcha izoh</label>
              <Input placeholder="Izoh..." {...register("notes")} />
            </div>

            <div className="p-3 bg-gray-50 rounded-lg space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">
                  {bookingType === "HOURLY"
                    ? `Xona narxi (${hourCount} soat)`
                    : `Xona narxi (${dialogNightCount} kecha)`}
                </span>
                <span className="text-sm font-semibold text-gray-900">{effectiveTotal.toLocaleString()} So'm</span>
              </div>

              {/* Chegirma: so'mda yoki foizda */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-600">Chegirma</span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={0}
                    max={discountType === "PERCENT" ? 100 : effectiveTotal}
                    className="h-8 w-28 text-right"
                    placeholder="0"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                  />
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    value={discountType}
                    onChange={(e) => {
                      setDiscountType(e.target.value as "AMOUNT" | "PERCENT")
                      setDiscountValue("")
                    }}
                  >
                    <option value="AMOUNT">So'm</option>
                    <option value="PERCENT">%</option>
                  </select>
                </div>
              </div>

              {/* Chegirma qo'llangan bo'lsa — yakuniy jami */}
              {discountAmount > 0 && (
                <div className="flex justify-between items-center border-t border-gray-200 pt-2">
                  <span className="text-sm font-medium text-gray-700">
                    Jami to'lov{" "}
                    <span className="text-xs font-normal text-red-500">
                      (−{discountAmount.toLocaleString()} So'm chegirma)
                    </span>
                  </span>
                  <span className="text-sm font-bold text-primary-700">
                    {finalTotal.toLocaleString()} So'm
                  </span>
                </div>
              )}

              <div className="border-t border-gray-200 pt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  To'lov summasi
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    id="payment_amount"
                    type="number"
                    min={0}
                    max={finalTotal}
                    placeholder="0"
                    {...register("payment_amount", { valueAsNumber: true })}
                  />
                  <select
                    className="w-full flex h-10 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    {...register("payment_method")}
                  >
                    <option value="">To'lov turini tanlang</option>
                    <option value="CASH">Naqd pul</option>
                    <option value="CREDIT_CARD">Kredit karta</option>
                    <option value="DEBIT_CARD">Debit karta</option>
                    <option value="BANK_TRANSFER">Bank o'tkazmasi</option>
                    <option value="MOBILE_PAYMENT">Mobil to'lov</option>
                    <option value="ONLINE">Onlayn</option>
                  </select>
                </div>
                {errors.payment_method && <p className="text-xs text-red-500 mt-1">{errors.payment_method.message}</p>}

                {/* Qisman (bo'lib) to'lov: qo'shimcha qatorlar — masalan bir
                    qismi naqd, qolgani bank kartasi bilan */}
                {extraPayments.map((p, i) => (
                  <div key={i} className="mt-2 flex items-center gap-3">
                    <Input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={p.amount}
                      onChange={(e) => updateExtraPayment(i, { amount: e.target.value })}
                      className="flex-1"
                    />
                    <select
                      className="flex-1 flex h-10 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      value={p.method}
                      onChange={(e) => updateExtraPayment(i, { method: e.target.value })}
                    >
                      <option value="">To'lov turini tanlang</option>
                      {PAYMENT_METHOD_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeExtraPayment(i)}
                      className="flex-shrink-0 p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                      title="Qatorni o'chirish"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}

                <div className="mt-2 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={addExtraPayment}
                    className="text-xs font-medium text-primary-700 hover:text-primary-800"
                  >
                    + To'lov usulini qo'shish
                  </button>
                  {(extraPayments.length > 0 || paidTotal > 0) && (
                    <span
                      className={cn(
                        "text-xs text-right",
                        finalTotal > 0 && paidTotal > finalTotal
                          ? "text-red-500 font-medium"
                          : "text-gray-500"
                      )}
                    >
                      Jami to'lov: {paidTotal.toLocaleString()} So'm
                      {finalTotal > 0 && paidTotal <= finalTotal && remainingAmount > 0 && (
                        <> · Qolgan: {remainingAmount.toLocaleString()} So'm</>
                      )}
                      {finalTotal > 0 && paidTotal > finalTotal && " (narxdan oshiq!)"}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                Bekor qilish
              </Button>
              <Button
                type="submit"
                disabled={
                  createReservationMutation.isPending ||
                  createGuestMutation.isPending ||
                  photoUploading ||
                  selectedTimeConflict
                }
              >
                {(createReservationMutation.isPending ||
                  createGuestMutation.isPending ||
                  photoUploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Tasdiqlash
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bronni boshqarish modali: ko'rish / tahrirlash / bekor qilish */}
      <Dialog open={manageOpen} onOpenChange={(o) => (o ? setManageOpen(true) : closeManageModal())}>
        <DialogContent className="sm:max-w-[500px]">
          {selectedReservation && (() => {
            const res = selectedReservation
            const isHourly = editValues.booking_type === "HOURLY"
            // Yakunlangan holatdagi bronni tahrirlab ham, bekor qilib ham bo'lmaydi
            const statusLocked = ["CHECKED_OUT", "CANCELLED", "NO_SHOW"].includes(res.status)
            // Tahrirlash / bekor qilish alohida ruxsatlarga bog'liq
            const locked = !canUpdate || statusLocked
            const cancelLocked = !canCancel || statusLocked
            const roomObj = rooms.find((r) => r.id === res.room_id)
            const saving = updateReservationMutation.isPending
            const cancelling = cancelReservationMutation.isPending
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    Bron · {res.reservation_number || ""}
                    <span
                      className={cn(
                        "text-[11px] font-medium px-2 py-0.5 rounded-full",
                        statusColors[res.status] || statusColors.PENDING
                      )}
                    >
                      {statusLabels[res.status] || res.status}
                    </span>
                  </DialogTitle>
                </DialogHeader>

                <div className="py-3 space-y-4">
                  {/* Umumiy ma'lumot */}
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <BedDouble className="h-5 w-5 text-primary-600" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {getGuestName(res)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {roomObj?.room_number || res.room_id?.slice(0, 8)} ·{" "}
                        {res.booking_type === "HOURLY"
                          ? `${resStartDate(res)} · ${resTimeRange(res)}`
                          : `${res.check_in_date} → ${res.check_out_date}`}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        Jami: {Number(res.total_amount || 0).toLocaleString()} So'm · To'langan:{" "}
                        {Number(res.paid_amount || 0).toLocaleString()} So'm
                      </p>
                    </div>
                  </div>

                  {/* TAHRIRLASH rejimi */}
                  {editMode && !locked && (
                    <div className="space-y-4">
                      <div className="flex rounded-lg bg-gray-100 p-1">
                        {([
                          { key: "DAILY", label: "Kunlik" },
                          { key: "HOURLY", label: "Soatlik" },
                        ] as const).map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => setEditValues((v: any) => ({ ...v, booking_type: opt.key }))}
                            className={cn(
                              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                              editValues.booking_type === opt.key
                                ? "bg-white text-primary-700 shadow-sm"
                                : "text-gray-500 hover:text-gray-700"
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {isHourly ? (
                        <>
                          <div className="space-y-1">
                            <label className="text-sm font-medium">Sana</label>
                            <Input
                              type="date"
                              value={editValues.check_in_date || ""}
                              onChange={(e) =>
                                setEditValues((v: any) => ({ ...v, check_in_date: e.target.value }))
                              }
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <label className="text-sm font-medium">Kirish vaqti</label>
                              <Input
                                type="time"
                                value={editValues.check_in_time || ""}
                                onChange={(e) =>
                                  setEditValues((v: any) => ({ ...v, check_in_time: e.target.value }))
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-sm font-medium">Chiqish vaqti</label>
                              <Input
                                type="time"
                                value={editValues.check_out_time || ""}
                                onChange={(e) =>
                                  setEditValues((v: any) => ({ ...v, check_out_time: e.target.value }))
                                }
                              />
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-sm font-medium">Kirish sanasi</label>
                            <Input
                              type="date"
                              value={editValues.check_in_date || ""}
                              onChange={(e) =>
                                setEditValues((v: any) => ({ ...v, check_in_date: e.target.value }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-sm font-medium">Chiqish sanasi</label>
                            <Input
                              type="date"
                              value={editValues.check_out_date || ""}
                              onChange={(e) =>
                                setEditValues((v: any) => ({ ...v, check_out_date: e.target.value }))
                              }
                            />
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-sm font-medium">Kattalar soni</label>
                          <Input
                            type="number"
                            min="1"
                            value={editValues.adults ?? 1}
                            onChange={(e) =>
                              setEditValues((v: any) => ({ ...v, adults: e.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium">Bolalar soni</label>
                          <Input
                            type="number"
                            min="0"
                            value={editValues.children ?? 0}
                            onChange={(e) =>
                              setEditValues((v: any) => ({ ...v, children: e.target.value }))
                            }
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-sm font-medium">Qo'shimcha izoh</label>
                        <Input
                          placeholder="Izoh..."
                          value={editValues.notes || ""}
                          onChange={(e) =>
                            setEditValues((v: any) => ({ ...v, notes: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                  )}

                  {/* BEKOR QILISH tasdiqi */}
                  {cancelMode && (
                    <div className="space-y-2 p-3 bg-red-50 border border-red-100 rounded-lg">
                      <p className="text-sm text-red-700 font-medium">
                        Ushbu bronni bekor qilmoqchimisiz?
                      </p>
                      <Input
                        placeholder="Bekor qilish sababi (ixtiyoriy)"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                      />
                    </div>
                  )}

                  {locked && cancelLocked && !cancelMode && (
                    <p className="text-xs text-gray-400">
                      {statusLocked
                        ? "Bu holatdagi bronni tahrirlab bo'lmaydi."
                        : "Bu bronni o'zgartirish uchun ruxsatingiz yo'q."}
                    </p>
                  )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                  {cancelMode ? (
                    <>
                      <Button variant="outline" onClick={() => setCancelMode(false)} disabled={cancelling}>
                        Orqaga
                      </Button>
                      <Button variant="destructive" onClick={handleCancelReservation} disabled={cancelling}>
                        {cancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Ha, bekor qilish
                      </Button>
                    </>
                  ) : editMode ? (
                    <>
                      <Button variant="outline" onClick={() => setEditMode(false)} disabled={saving}>
                        Orqaga
                      </Button>
                      <Button onClick={handleUpdateReservation} disabled={saving}>
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Saqlash
                      </Button>
                    </>
                  ) : (
                    <div className="flex w-full items-center justify-between">
                      {!cancelLocked ? (
                        <Button
                          variant="ghost"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setCancelMode(true)}
                        >
                          <Ban className="h-4 w-4 mr-2" />
                          Bronni bekor qilish
                        </Button>
                      ) : (
                        <span />
                      )}
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={closeManageModal}>
                          Yopish
                        </Button>
                        {!locked && (
                          <Button onClick={() => setEditMode(true)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Tahrirlash
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Surib ko'chirishni tasdiqlash dialogi */}
      <Dialog open={!!moveConfirm} onOpenChange={(o) => !o && setMoveConfirm(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Bronni ko'chirish</DialogTitle>
          </DialogHeader>
          {moveConfirm && (
            <div className="py-2 space-y-2">
              <p className="text-sm text-gray-700">
                <span className="font-semibold">{getGuestName(moveConfirm.res)}</span> bronini
                boshqa kunga ko'chirmoqchimisiz?
              </p>
              <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg text-sm">
                <span className="text-gray-500">{moveConfirm.from}</span>
                <ChevronRight className="h-4 w-4 text-gray-400" />
                <span className="font-semibold text-primary-700">{moveConfirm.to}</span>
                {moveConfirm.res?.booking_type === "HOURLY" && (
                  <span className="text-gray-400 text-xs ml-1">
                    ({resTimeRange(moveConfirm.res)})
                  </span>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMoveConfirm(null)}
              disabled={updateReservationMutation.isPending}
            >
              Bekor qilish
            </Button>
            <Button onClick={performMove} disabled={updateReservationMutation.isPending}>
              {updateReservationMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Ha, ko'chirish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bir kundagi bronlar ro'yxati dialogi */}
      <Dialog open={!!dayList} onOpenChange={(o) => !o && setDayList(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {dayList?.roomNumber} xona · {dayList?.date} — bronlar ({dayListItems.length})
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 max-h-80 overflow-y-auto divide-y divide-gray-100">
            {dayListItems.map((r) => (
              <button
                key={r.id}
                type="button"
                className="w-full flex items-center justify-between gap-3 px-2 py-3 text-left hover:bg-gray-50 rounded-lg transition-colors"
                onClick={() => {
                  setDayList(null)
                  openManageModal(r)
                }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {resTimeRange(r)}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{getGuestName(r)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className={cn(
                      "text-[10px] font-medium px-2 py-0.5 rounded-full",
                      statusColors[r.status] || statusColors.PENDING
                    )}
                  >
                    {statusLabels[r.status] || r.status}
                  </span>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </div>
              </button>
            ))}
            {dayListItems.length === 0 && (
              <p className="py-6 text-sm text-gray-400 text-center">Bronlar topilmadi</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDayList(null)}>
              Yopish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Xato dialogi (brauzer alert o'rniga) */}
      <Dialog open={!!errorDialog} onOpenChange={(o) => !o && setErrorDialog(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Ban className="h-5 w-5" />
              Xatolik
            </DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-gray-700 whitespace-pre-line">{errorDialog}</p>
          <DialogFooter>
            <Button onClick={() => setErrorDialog(null)}>Tushunarli</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

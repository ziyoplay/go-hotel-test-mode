import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { loginWithPasskey } from "@/features/auth/api/webauthn";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { apiErrorMessage } from "@/lib/apiError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AlertCircle, Building2, Eye, EyeOff, Loader2, Lock, ScanFace, User } from "lucide-react";

const loginSchema = z.object({
  username: z.string().min(1, "Foydalanuvchi nomi kiritilishi shart"),
  password: z.string().min(4, "Parol kamida 4 ta belgidan iborat bo'lishi kerak"),
});

export const LoginPage = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [faceIdLoading, setFaceIdLoading] = useState(false);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  // Login ekranida tab sarlavhasi standart nomga qaytadi
  useEffect(() => {
    document.title = "GoHotel";
  }, []);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const completeLogin = async (accessToken: string, refreshToken: string) => {
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refreshToken);

    const profileRes = await api.get("/auth/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    setAuth(profileRes.data, accessToken, refreshToken);
    navigate("/");
  };

  const onSubmit = async (values: z.infer<typeof loginSchema>) => {
    try {
      setIsLoading(true);
      setError(null);
      const { data } = await api.post("/auth/login", values);
      await completeLogin(data.access_token, data.refresh_token);
    } catch (err: any) {
      console.error("Login error", err);
      setError(err.response?.data?.detail || "Tizimga kirishda xatolik yuz berdi");
    } finally {
      setIsLoading(false);
    }
  };

  const onFaceIdLogin = async () => {
    if (!browserSupportsWebAuthn()) {
      setError("Bu brauzer Face ID/Windows Hello orqali kirishni qo'llab-quvvatlamaydi.");
      return;
    }
    try {
      setFaceIdLoading(true);
      setError(null);
      const username = form.getValues("username") || undefined;
      const data = await loginWithPasskey(username);
      await completeLogin(data.access_token, data.refresh_token);
    } catch (err: any) {
      if (err?.name === "NotAllowedError") {
        // Foydalanuvchi bekor qildi yoki mos passkey topilmadi — xatolik ko'rsatmaymiz
        return;
      }
      if (err?.name === "SecurityError") {
        setError(
          window.isSecureContext
            ? "Face ID bu domenda ishlamaydi — server boshqa (asosiy) domen uchun sozlangan."
            : "Face ID faqat xavfsiz ulanishda (HTTPS) ishlaydi."
        );
        return;
      }
      console.error("Face ID login error", err);
      setError(apiErrorMessage(err) || "Face ID orqali kirishda xatolik yuz berdi");
    } finally {
      setFaceIdLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 p-4">
      {/* Suzuvchi yorug' dog'lar */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary-500/30 blur-3xl animate-login-blob" />
      <div
        className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-indigo-500/25 blur-3xl animate-login-blob"
        style={{ animationDelay: "-6s" }}
      />
      <div
        className="pointer-events-none absolute top-1/3 left-2/3 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl animate-login-blob"
        style={{ animationDelay: "-11s" }}
      />
      {/* Nozik nuqtali to'r */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.06)_1px,transparent_0)] bg-[size:28px_28px]" />

      <div className="relative z-10 w-full max-w-sm animate-login-rise">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-indigo-600 shadow-lg shadow-primary-600/40">
            <Building2 className="text-white" size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">GoHotel</h1>
            <p className="mt-1 text-sm text-slate-300/80">
              Mehmonxona boshqaruv tizimiga xush kelibsiz
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/95 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-7">
          <div className="mb-5">
            <h2 className="text-lg font-semibold tracking-tight">Tizimga kirish</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Hisob ma'lumotlaringizni kiriting
            </p>
          </div>

          <Form {...form}>
            {/* Enter bosilganda ham forma yuboriladi — Kirish tugmasi type="submit" */}
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Foydalanuvchi nomi</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <User
                          size={16}
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                          placeholder="admin"
                          autoFocus
                          autoComplete="username"
                          className="h-11 pl-9 transition-shadow focus-visible:shadow-md focus-visible:shadow-primary-500/10"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parol</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock
                          size={16}
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          className="h-11 pl-9 pr-10 transition-shadow focus-visible:shadow-md focus-visible:shadow-primary-500/10"
                          {...field}
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={showPassword ? "Parolni yashirish" : "Parolni ko'rsatish"}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && (
                <div
                  key={error}
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive animate-login-shake"
                >
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={isLoading || faceIdLoading}
                className="h-11 w-full bg-gradient-to-r from-primary-600 to-indigo-600 text-base font-semibold shadow-lg shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-indigo-500 hover:shadow-primary-500/40 active:scale-[0.98]"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 size={18} className="animate-spin" />
                    Kirilmoqda...
                  </span>
                ) : (
                  "Kirish"
                )}
              </Button>
            </form>
          </Form>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white/95 px-2 text-muted-foreground">yoki</span>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            disabled={faceIdLoading || isLoading}
            onClick={onFaceIdLogin}
          >
            <ScanFace className="mr-2 h-4 w-4" />
            {faceIdLoading ? "Tekshirilmoqda..." : "Face ID bilan kirish"}
          </Button>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400/70">
          © {new Date().getFullYear()} GoHotel — mehmonxona boshqaruv tizimi
        </p>
      </div>
    </div>
  );
};

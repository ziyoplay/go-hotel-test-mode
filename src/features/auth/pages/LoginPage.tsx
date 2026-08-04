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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Building2, ScanFace } from "lucide-react";

const loginSchema = z.object({
  username: z.string().min(1, "Foydalanuvchi nomi kiritilishi shart"),
  password: z.string().min(4, "Parol kamida 4 ta belgidan iborat bo'lishi kerak"),
});

export const LoginPage = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        setError("Kamera/Face ID faqat xavfsiz ulanishda (HTTPS) ishlaydi.");
        return;
      }
      console.error("Face ID login error", err);
      setError(apiErrorMessage(err) || "Face ID orqali kirishda xatolik yuz berdi");
    } finally {
      setFaceIdLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Building2 className="text-primary-foreground" size={24} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">GoHotel</h1>
          <p className="text-sm text-muted-foreground">
            Mehmonxona boshqaruv tizimiga xush kelibsiz
          </p>
        </div>
        
        <Card className="border-border/50 shadow-sm backdrop-blur-sm bg-background/95">
          <CardHeader>
            <CardTitle>Tizimga kirish</CardTitle>
            <CardDescription>
              Hisob ma'lumotlaringizni kiriting
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Foydalanuvchi nomi</FormLabel>
                      <FormControl>
                        <Input placeholder="admin" {...field} />
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
                        <Input type="password" placeholder="••••••••" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {error && <div className="text-sm font-medium text-destructive">{error}</div>}
                <Button type="submit" className="w-full" disabled={isLoading || faceIdLoading}>
                  {isLoading ? "Kirilmoqda..." : "Kirish"}
                </Button>
              </form>
            </Form>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">yoki</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={faceIdLoading || isLoading}
              onClick={onFaceIdLogin}
            >
              <ScanFace className="mr-2 h-4 w-4" />
              {faceIdLoading ? "Tekshirilmoqda..." : "Face ID bilan kirish"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

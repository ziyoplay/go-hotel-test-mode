import axios from "axios";

// Dev rejimida nisbiy "/api/v1" ishlatiladi (vite dev-server proxy backendga uzatadi).
// Production buildda esa proxy bo'lmaydi — shuning uchun backendning to'liq manzili
// ishlatiladi (VITE_API_URL to'liq URL qilib berilsa, o'sha ustun turadi).
const PROD_URL = "https://gohotel-gohotel-backend-lhyen5-ecceab-13-140-185-49.sslip.io";
// Test frontend (go-hotel-test-mode) o'zining alohida test backend'iga ulanadi.
// Dokploy build vaqtida repo .env'ini o'z Environment maydoni bilan almashtirib
// yuborgani uchun tanlov build-time env'ga emas, sahifa ochilgan domenga qarab
// runtime'da qilinadi.
const TEST_FRONTEND_HOST = "gohotel-go-hotel-test-ceiqr0-33ceba-13-140-185-49.sslip.io";
const TEST_URL = "https://gohotel-backendtest-epycue-df84d6-13-140-185-49.sslip.io";
const BASE_URL =
  typeof window !== "undefined" && window.location.hostname === TEST_FRONTEND_HOST
    ? TEST_URL
    : PROD_URL;
const envUrl = import.meta.env.VITE_API_URL || "/api/v1";
export const API_URL =
  import.meta.env.DEV || envUrl.startsWith("http") ? envUrl : `${BASE_URL}${envUrl}`;

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("accessToken");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem("refreshToken");
        if (!refreshToken) throw new Error("No refresh token");
        
        const { data } = await axios.post(`${API_URL}/auth/refresh`, { refresh_token: refreshToken });
        localStorage.setItem("accessToken", data.access_token);
        
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
        return api(originalRequest);
      } catch (err) {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        window.location.href = "/login";
        return Promise.reject(err);
      }
    }
    return Promise.reject(error);
  }
);

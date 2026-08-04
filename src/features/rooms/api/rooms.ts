import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Room, Floor, RoomType } from '@/types/api';

export interface Branch {
  id: string;
  hotel_id: string;
  name: string;
  code?: string;
}

// Foydalanuvchining mehmonxonasidagi filiallar (backend hotel bo'yicha filtrlaydi)
export const useBranches = () => {
  return useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get<{ items: Branch[] }>('/branches/', {
        params: { page_size: 500 },
      });
      return Array.isArray(data) ? data : (data.items || []);
    },
  });
};

// Tanlangan filial qavatlari
export const useFloorsByBranch = (branchId?: string) => {
  return useQuery({
    queryKey: ['floors', branchId],
    queryFn: async () => {
      const { data } = await api.get<{ items: Floor[] }>('/floors/', {
        params: { branch_id: branchId, limit: 200 },
      });
      const list = Array.isArray(data) ? data : (data.items || []);
      return [...list].sort((a, b) => a.floor_number - b.floor_number);
    },
    enabled: !!branchId,
  });
};

interface FloorPayload {
  branch_id: string;
  hotel_id?: string;
  floor_number: number;
  name?: string;
}

export const useCreateFloor = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: FloorPayload) => {
      const { data } = await api.post<Floor>('/floors/', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['floors'] }),
  });
};

export const useUpdateFloor = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: { id: string; floor_number: number; name?: string }) => {
      const { data } = await api.put<Floor>(`/floors/${id}`, payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['floors'] }),
  });
};

export const useDeleteFloor = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/floors/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['floors'] });
      // Qavat bilan birga unga biriktirilgan xonalar ham o'chadi
      qc.invalidateQueries({ queryKey: ['rooms'] });
    },
  });
};

export const useRooms = (status?: string) => {
  return useQuery({
    queryKey: ['rooms', status],
    queryFn: async () => {
      const { data } = await api.get<{ items: Room[] }>('/rooms/', {
        params: { status, limit: 500, page_size: 500 }
      });
      const list = Array.isArray(data) ? data : (data.items || []);
      // O'chirilgan (soft-delete) xonalar hech qayerda ko'rinmasligi kerak —
      // backend ham filtrlaydi, bu esa qo'shimcha himoya
      return list.filter((r) => !r.is_deleted);
    },
  });
};

export const useFloors = () => {
  return useQuery({
    queryKey: ['floors'],
    queryFn: async () => {
      const { data } = await api.get<{ items: Floor[] }>('/floors/', {
        params: { limit: 200 }
      });
      return Array.isArray(data) ? data : (data.items || []);
    },
  });
};

export const useRoomTypes = () => {
  return useQuery({
    queryKey: ['roomTypes'],
    queryFn: async () => {
      const { data } = await api.get<{ items: any[] }>('/room-types/', {
        params: { limit: 100 }
      });
      return Array.isArray(data) ? data : (data.items || []);
    },
  });
};

// --- Xona turlari CRUD (boshqaruv sahifasi uchun) ---

interface RoomTypePayload {
  name: string;
  description?: string;
  capacity?: number;
  base_price: number;
}

export const useCreateRoomType = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ hotelId, ...payload }: RoomTypePayload & { hotelId?: string }) => {
      const { data } = await api.post<RoomType>('/room-types/', payload, {
        params: hotelId ? { hotel_id: hotelId } : {},
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roomTypes'] }),
  });
};

export const useUpdateRoomType = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: Partial<RoomTypePayload> & { id: string }) => {
      const { data } = await api.put<RoomType>(`/room-types/${id}`, payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roomTypes'] }),
  });
};

export const useDeleteRoomType = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/room-types/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roomTypes'] }),
  });
};

// Holatni yoqish/o'chirish — backend buni query param sifatida kutadi
export const useUpdateRoomTypeStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data } = await api.patch<RoomType>(`/room-types/${id}/status`, null, {
        params: { is_active },
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roomTypes'] }),
  });
};

// --- Xonalar CRUD (boshqaruv uchun) ---

interface RoomPayload {
  branch_id: string;
  floor_id: string;
  room_type_id: string;
  room_number: string;
  base_price?: number;
  capacity?: number;
  notes?: string;
}

export const useCreateRoom = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ hotelId, ...body }: RoomPayload & { hotelId?: string }) => {
      const { data } = await api.post<Room>('/rooms/', body, {
        params: hotelId ? { hotel_id: hotelId } : {},
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rooms'] }),
  });
};

export const useUpdateRoom = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      hotelId,
      ...body
    }: Partial<Omit<RoomPayload, 'branch_id' | 'room_number'>> & {
      id: string;
      hotelId?: string;
    }) => {
      const { data } = await api.put<Room>(`/rooms/${id}`, body, {
        params: hotelId ? { hotel_id: hotelId } : {},
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rooms'] }),
  });
};

export const useDeleteRoom = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, hotelId }: { id: string; hotelId?: string }) => {
      await api.delete(`/rooms/${id}`, {
        params: hotelId ? { hotel_id: hotelId } : {},
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rooms'] }),
  });
};

export const useUpdateRoomStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      notes,
      hotelId,
    }: {
      id: string;
      status: string;
      notes?: string;
      hotelId?: string;
    }) => {
      const { data } = await api.patch<Room>(
        `/rooms/${id}/status`,
        { status, notes: notes || null },
        { params: hotelId ? { hotel_id: hotelId } : {} }
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rooms'] }),
  });
};

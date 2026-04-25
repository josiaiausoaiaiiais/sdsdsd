import axios from "axios";
import { useEffect, useState, useCallback } from "react";
import { API } from "./auth";

export function useMetrics() {
  const [data, setData] = useState(null);
  useEffect(() => {
    axios.get(`${API}/dashboard/metrics`).then(r => setData(r.data)).catch(() => setData(false));
  }, []);
  return data;
}

export function useUploads() {
  const [items, setItems] = useState(null);
  const refresh = useCallback(() => {
    axios.get(`${API}/uploads`).then(r => setItems(r.data)).catch(() => setItems([]));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const add = async (payload) => {
    const { data } = await axios.post(`${API}/uploads`, payload);
    setItems(prev => [data, ...(prev || [])]);
    return data;
  };
  const addFile = async (file, title, ratio = "16:9") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", title || file.name);
    fd.append("ratio", ratio);
    const { data } = await axios.post(`${API}/uploads/file`, fd, { headers: { "Content-Type": "multipart/form-data" } });
    setItems(prev => [data, ...(prev || [])]);
    return data;
  };
  const remove = async (id) => {
    await axios.delete(`${API}/uploads/${id}`);
    setItems(prev => (prev || []).filter(x => x.id !== id));
  };
  return { items, add, addFile, remove, refresh };
}

export async function savePreset(uploadId, preset) {
  return (await axios.put(`${API}/uploads/${uploadId}/preset`, preset)).data;
}

export async function generateRemix(prompt, style, ratio) {
  return (await axios.post(`${API}/remix/generate`, { prompt, style, ratio })).data;
}

export function resolveVideoUrl(u) {
  if (!u) return null;
  if (u.startsWith("http")) return u;
  if (u.startsWith("/api")) return `${process.env.REACT_APP_BACKEND_URL}${u}`;
  return u;
}

export function useFavorites() {
  const [items, setItems] = useState(null);
  const refresh = useCallback(() => {
    axios.get(`${API}/favorites`).then(r => setItems(r.data)).catch(() => setItems([]));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const toggle = async (uploadId, isFav) => {
    if (isFav) await axios.delete(`${API}/favorites/${uploadId}`);
    else await axios.post(`${API}/favorites`, { upload_id: uploadId });
    refresh();
  };
  return { items, toggle, refresh };
}

export function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s/86400)}d ago`;
  return d.toLocaleDateString();
}

export function fmtDuration(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

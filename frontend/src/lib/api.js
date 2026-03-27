import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

export default api;

// Auth
export const getMe = () => axios.get('/auth/me', { withCredentials: true }).then(r => r.data);
export const logout = () => axios.post('/auth/logout', {}, { withCredentials: true });

// Videos
export const getVideos = () => api.get('/videos').then(r => r.data);
export const uploadVideo = (file, onProgress) => {
  const fd = new FormData();
  fd.append('video', file);
  return api.post('/videos', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => onProgress?.(Math.round((e.loaded * 100) / e.total)),
  }).then(r => r.data);
};
export const deleteVideo = (id) => api.delete(`/videos/${id}`).then(r => r.data);

// Streams
export const getStreams = () => api.get('/streams').then(r => r.data);
export const getStream = (id) => api.get(`/streams/${id}`).then(r => r.data);
export const createStream = (data) => api.post('/streams', data).then(r => r.data);
export const updateStream = (id, data) => api.patch(`/streams/${id}`, data).then(r => r.data);
export const deleteStream = (id) => api.delete(`/streams/${id}`).then(r => r.data);
export const startStream = (id) => api.post(`/streams/${id}/start`).then(r => r.data);
export const stopStream = (id) => api.post(`/streams/${id}/stop`).then(r => r.data);
export const updatePlaylist = (id, videoIds) =>
  api.put(`/streams/${id}/playlist`, { videoIds }).then(r => r.data);

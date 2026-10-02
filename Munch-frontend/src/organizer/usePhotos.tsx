import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { PhotoPage } from '../types';
import { useOrganizer } from './i18n';

/**
 * Hook that mirrors the existing Photos.tsx internals but exposes a
 * simpler shape for the new EventOverview Photos tab.
 *
 * It keeps minimal local state: the loaded page, the selected folder, and
 * a loading flag. Mutations reload the whole album afterwards so the
 * folder/photo counts and cover thumbnails stay in sync.
 */
export const usePhotos = (eventRef: string) => {
  const { t } = useOrganizer();
  const [page, setPage] = useState<PhotoPage | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (quiet = false) => {
    if (!eventRef) {
      setPage(null);
      setLoading(false);
      return;
    }
    try {
      const got = await apiClient.getPhotos(eventRef);
      setPage({
        ...got,
        folders: got?.folders ?? [],
        photos: got?.photos ?? [],
      });
    } catch {
      if (!quiet) {
        toast.error(t({ ne: 'तस्बिर ल्याउन सकिएन', en: 'Could not load the photographs' }));
      }
    } finally {
      setLoading(false);
    }
  }, [eventRef, t]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const createFolder = async (name: string) => {
    try {
      await apiClient.createPhotoFolder(eventRef, name);
      await load(true);
      toast.success(t({ ne: 'फोल्डर बनाइयो', en: 'Folder created' }));
    } catch {
      toast.error(t({ ne: 'फोल्डर बनाउन सकिएन', en: 'Could not create folder' }));
    }
  };

  const renameFolder = async (folderId: string, name: string) => {
    if (!name.trim()) return;
    try {
      await apiClient.renamePhotoFolder(eventRef, folderId, name.trim());
      await load(true);
      toast.success(t({ ne: 'नाम परिवर्तन गरियो', en: 'Folder renamed' }));
    } catch {
      toast.error(t({ ne: 'नाम परिवर्तन गर्न सकिएन', en: 'Could not rename folder' }));
    }
  };

  const deleteFolder = async (folderId: string) => {
    try {
      await apiClient.deletePhotoFolder(eventRef, folderId);
      if (selectedFolder === folderId) setSelectedFolder(null);
      await load(true);
      toast.success(t({ ne: 'फोल्डर मेटाइयो', en: 'Folder deleted' }));
    } catch {
      toast.error(t({ ne: 'फोल्डर मेटाउन सकिएन', en: 'Could not delete folder' }));
    }
  };

  const uploadPhoto = async (folderId: string, file: File, caption = '') => {
    try {
      await apiClient.uploadPhoto(eventRef, folderId, file, caption);
      await load(true);
      toast.success(t({ ne: 'फोटो अपलोड गरियो', en: 'Photo uploaded' }));
    } catch {
      toast.error(t({ ne: 'फोटो अपलोड गर्न सकिएन', en: 'Could not upload photo' }));
    }
  };

  const deletePhoto = async (photoId: string) => {
    try {
      await apiClient.deletePhoto(photoId);
      await load(true);
      toast.success(t({ ne: 'फोटो मेटाइयो', en: 'Photo deleted' }));
    } catch {
      toast.error(t({ ne: 'फोटो मेटाउन सकिएन', en: 'Could not delete photo' }));
    }
  };

  return {
    folders: page?.folders ?? [],
    photos: page?.photos ?? [],
    loading,
    selectedFolder,
    setSelectedFolder,
    createFolder,
    renameFolder,
    deleteFolder,
    uploadPhoto,
    deletePhoto,
    reload: load,
  };
};

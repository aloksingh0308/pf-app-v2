import { hideLoader, showLoader } from '@/store/slices/loaderSlice';
import { useCallback } from 'react';
import { useDispatch } from 'react-redux';

export function useAppLoader() {
  const dispatch = useDispatch();

  const show = useCallback((message?: string) => {
    dispatch(showLoader(message));
    return Promise.resolve();
  }, [dispatch]);

  const hide = useCallback(() => {
    dispatch(hideLoader());
  }, [dispatch]);

  return { show, hide };
}

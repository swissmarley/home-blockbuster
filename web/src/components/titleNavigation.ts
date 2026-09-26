import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const BROWSE_PATHS = ['/browse', '/tv', '/movies', '/latest', '/my-list', '/search'];

/** Open the detail modal ("More Info") for a title on top of the current browse page. */
export function useOpenTitle(): (titleId: string) => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (titleId: string) => {
      const onBrowse = BROWSE_PATHS.includes(location.pathname);
      const params = new URLSearchParams(onBrowse ? location.search : '');
      params.set('jbv', titleId);
      navigate(
        { pathname: onBrowse ? location.pathname : '/browse', search: `?${params.toString()}` },
        { state: { jbv: true }, replace: onBrowse && new URLSearchParams(location.search).has('jbv') },
      );
    },
    [navigate, location.pathname, location.search],
  );
}

export function useCloseTitle(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if ((location.state as { jbv?: boolean } | null)?.jbv) {
      navigate(-1);
      return;
    }
    const params = new URLSearchParams(location.search);
    params.delete('jbv');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  }, [navigate, location.pathname, location.search, location.state]);
}

export function usePlay(): (fileId: string | null | undefined, opts?: { start?: number }) => void {
  const navigate = useNavigate();
  return useCallback(
    (fileId, opts) => {
      if (!fileId) return;
      navigate(`/watch/${fileId}${opts?.start !== undefined ? `?t=${Math.floor(opts.start)}` : ''}`);
    },
    [navigate],
  );
}

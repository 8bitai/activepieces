import { flagsHooks } from '@/hooks/flags-hooks';

const FullLogo = () => {
  const branding = flagsHooks.useWebsiteBranding();

  if (!branding.logos.fullLogoUrl) {
    return (
      <div className="h-[60px] flex items-center">
        <span className="text-2xl font-bold tracking-tight">
          {branding.websiteName}
        </span>
      </div>
    );
  }

  return (
    <div className="h-[60px]">
      <img
        className="h-full"
        src={branding.logos.fullLogoUrl}
        alt={branding.websiteName}
      />
    </div>
  );
};
FullLogo.displayName = 'FullLogo';
export { FullLogo };

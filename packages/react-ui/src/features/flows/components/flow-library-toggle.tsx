import { t } from 'i18next';
import { Check, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';

import { LoadingSpinner } from '@/components/ui/spinner';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { FlowOperationType, Permission, PopulatedFlow } from '@activepieces/shared';

import { Switch } from '../../../components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../../components/ui/tooltip';
import { flowHooks } from '../lib/flow-hooks';

type FlowLibraryToggleProps = {
  flow: PopulatedFlow;
};

const FlowLibraryToggle = ({ flow }: FlowLibraryToggleProps) => {
  const [isLibrary, setIsLibrary] = useState(flow.library ?? false);

  useEffect(() => {
    setIsLibrary(flow.library ?? false);
  }, [flow.library]);

  const { checkAccess } = useAuthorization();
  const userHasPermissionToToggleLibrary = checkAccess(Permission.WRITE_FLOW);

  const { mutate: changeLibrary, isPending: isLoading } =
    flowHooks.useChangeFlowLibrary({
      flowId: flow.id,
      onSuccess: (updatedFlow) => {
        setIsLibrary(updatedFlow.library ?? false);
      },
    });

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center justify-center">
            <Switch
              checked={isLibrary}
              checkedIcon={<Check className="h-2.5 w-2.5 text-primary" />}
              onCheckedChange={(checked) => changeLibrary(checked)}
              disabled={isLoading || !userHasPermissionToToggleLibrary}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {userHasPermissionToToggleLibrary
            ? isLibrary
              ? t('In library')
              : t('Not in library')
            : t('Permission Needed')}
        </TooltipContent>
      </Tooltip>
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        isLibrary && (
          <Tooltip>
            <TooltipTrigger asChild onClick={(e) => e.stopPropagation()}>
              <div className="p-2 rounded-full">
                <Zap className="h-4 w-4 text-foreground fill-foreground" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t('In library')}
            </TooltipContent>
          </Tooltip>
        )
      )}
    </>
  );
};

FlowLibraryToggle.displayName = 'FlowLibraryToggle';
export { FlowLibraryToggle };

import { t } from 'i18next';
import { useEffect, useState } from 'react';

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
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center justify-center">
          <Switch
            checked={isLibrary}
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
  );
};

FlowLibraryToggle.displayName = 'FlowLibraryToggle';
export { FlowLibraryToggle };

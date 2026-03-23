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

type FlowPushToEmbedToggleProps = {
  flow: PopulatedFlow;
};

const FlowPushToEmbedToggle = ({ flow }: FlowPushToEmbedToggleProps) => {
  const [isPushToEmbed, setIsPushToEmbed] = useState(flow.pushToEmbed ?? false);

  useEffect(() => {
    setIsPushToEmbed(flow.pushToEmbed ?? false);
  }, [flow.pushToEmbed]);

  const { checkAccess } = useAuthorization();
  const userHasPermission = checkAccess(Permission.WRITE_FLOW);

  const { mutate: changePushToEmbed, isPending: isLoading } =
    flowHooks.useChangeFlowPushToEmbed({
      flowId: flow.id,
      onSuccess: (updatedFlow) => {
        setIsPushToEmbed(updatedFlow.pushToEmbed ?? false);
      },
    });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center justify-center">
          <Switch
            checked={isPushToEmbed}
            onCheckedChange={(checked) => changePushToEmbed(checked)}
            disabled={isLoading || !userHasPermission}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {userHasPermission
          ? isPushToEmbed
            ? t('Push to Embed enabled')
            : t('Push to Embed disabled')
          : t('Permission Needed')}
      </TooltipContent>
    </Tooltip>
  );
};

FlowPushToEmbedToggle.displayName = 'FlowPushToEmbedToggle';
export { FlowPushToEmbedToggle };

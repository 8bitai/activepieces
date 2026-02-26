import { InfoCircledIcon } from '@radix-ui/react-icons';
import { useMutation } from '@tanstack/react-query';
import { t } from 'i18next';
import { Check, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { flowsApi } from '@/features/flows/lib/flows-api';
import { flowHooks } from '@/features/flows/lib/flow-hooks';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { API_URL } from '@/lib/api';
import { RightSideBarType } from '@/lib/types';
import {
  FlowOperationType,
  FlowRun,
  FlowStatusUpdatedResponse,
  FlowVersion,
  FlowVersionState,
  isNil,
  Permission,
} from '@activepieces/shared';

import { useBuilderStateContext } from '../../builder-hooks';

import LargeWidgetWrapper from './large-widget-wrapper';

const PublishFlowReminderWidget = () => {
  const [
    isSaving,
    isPublishing,
    setIsPublishing,
    isValid,
    flow,
    setFlow,
    setVersion,
    setRightSidebar,
    flowVersion,
    run,
    outputSampleData,
  ] = useBuilderStateContext((state) => [
    state.saving,
    state.isPublishing,
    state.setIsPublishing,
    state.flowVersion.valid,
    state.flow,
    state.setFlow,
    state.setVersion,
    state.setRightSidebar,
    state.flowVersion,
    state.run,
    state.outputSampleData,
  ]);
  const showShouldPublishButton = useShouldShowPublishButton({
    flowVersion,
    isPublishing,
    run,
    isSaving,
  });
  const { mutate: discardChange, isPending: isDiscardingChanges } = useMutation(
    {
      mutationFn: async () => {
        if (!flow.publishedVersionId) {
          return;
        }
        await overWriteDraftWithVersion({
          flowId: flow.id,
          versionId: flow.publishedVersionId,
        });
        await publish();
      },
    },
  );
  const { mutateAsync: publish } = flowHooks.useChangeFlowStatus({
    flowId: flow.id,
    change: 'publish',
    onSuccess: (response: FlowStatusUpdatedResponse) => {
      setFlow(response.flow);
      setVersion(response.flow.version);
    },
    setIsPublishing: setIsPublishing,
  });
  const { mutateAsync: overWriteDraftWithVersion } =
    flowHooks.useOverWriteDraftWithVersion({
      onSuccess: (updatedFlow) => {
        setVersion(updatedFlow.version);
        setRightSidebar(RightSideBarType.NONE);
      },
    });

  const [curlSaved, setCurlSaved] = useState(false);

  const webhookUrl = `${API_URL}/v1/webhooks/${flow.id}/sync`;
  const triggerSampleData = outputSampleData?.[flowVersion.trigger.name];
  const bodyJson = triggerSampleData
    ? JSON.stringify(triggerSampleData, null, 2)
    : '{}';
  const curlCommand = [
    `curl -X POST '${webhookUrl}'`,
    `  -H 'Content-Type: application/json'`,
    `  -d '${bodyJson.replace(/'/g, "'\\''")}'`,
  ].join(' \\\n');

  const { mutate: saveCurl, isPending: isSavingCurl } = useMutation({
    mutationFn: async () => {
      const updatedFlow = await flowsApi.update(flow.id, {
        type: FlowOperationType.UPDATE_METADATA,
        request: {
          metadata: {
            ...(flow.metadata ?? {}),
            webhookUrl,
            webhookCurl: curlCommand,
          },
        },
      });
      return updatedFlow;
    },
    onSuccess: (updatedFlow) => {
      setFlow(updatedFlow);
      setCurlSaved(true);
      toast.success(t('Webhook curl saved to flow metadata'), {
        description: curlCommand,
        duration: 6000,
      });
      setTimeout(() => setCurlSaved(false), 2000);
    },
    onError: () => {
      toast.error(t('Failed to save webhook curl'));
    },
  });

  if (!showShouldPublishButton) {
    return null;
  }
  const showLoading = isPublishing || isDiscardingChanges || isSaving;
  const loadingText = pickLoadingText({
    isDiscardingChanges,
    isPublishing,
    isSaving,
  });
  return (
    <LargeWidgetWrapper>
      <div className="flex items-center gap-2">
        <InfoCircledIcon className="size-5" />
        {showLoading ? loadingText : t('You have unpublished changes')}
      </div>
      {showLoading ? (
        <LoadingSpinner className="size-5 stroke-foreground" />
      ) : (
        <div className="flex items-center gap-2">
          {!isNil(flow.publishedVersionId) && !isSaving && (
            <Button
              size="sm"
              variant="ghost"
              className="hover:bg-gray-300/10 text-foreground"
              onClick={() => discardChange()}
            >
              {t('Discard changes')}
            </Button>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="z-50 gap-1"
                loading={isSavingCurl}
                onClick={() => saveCurl()}
              >
                {curlSaved ? (
                  <Check className="size-3.5" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {curlSaved ? t('Saved!') : t('Save curl')}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="font-medium mb-1">{t('Saves to flow metadata:')}</p>
              <pre className="text-xs whitespace-pre-wrap break-all">{curlCommand}</pre>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="tooltip-wrapper">
                <Button
                  size="sm"
                  variant="default"
                  className="z-50"
                  loading={isSaving}
                  //for e2e tests
                  name="Publish"
                  onClick={() => publish()}
                  disabled={!isValid}
                >
                  {t('Publish')}
                </Button>
              </div>
            </TooltipTrigger>
            {isSaving && <TooltipContent>{t('Saving...')}</TooltipContent>}
            {!isValid && (
              <TooltipContent>{t('You have incomplete steps')}</TooltipContent>
            )}
          </Tooltip>
        </div>
      )}
    </LargeWidgetWrapper>
  );
};

PublishFlowReminderWidget.displayName = 'PublishFlowReminderWidget';
export default PublishFlowReminderWidget;

const useShouldShowPublishButton = ({
  flowVersion,
  isPublishing,
  run,
  isSaving,
}: {
  flowVersion: FlowVersion;
  isPublishing: boolean;
  run: FlowRun | null;
  isSaving: boolean;
}) => {
  const { checkAccess } = useAuthorization();
  const permissionToEditFlow = checkAccess(Permission.WRITE_FLOW);
  const isViewingPublishableVersion =
    flowVersion.state === FlowVersionState.DRAFT;
  return (
    ((permissionToEditFlow && isViewingPublishableVersion) ||
      isPublishing ||
      isSaving) &&
    isNil(run)
  );
};

function pickLoadingText({
  isDiscardingChanges,
  isPublishing,
  isSaving,
}: {
  isDiscardingChanges: boolean;
  isPublishing: boolean;
  isSaving: boolean;
}) {
  if (isSaving) {
    return t('Saving...');
  }
  if (isDiscardingChanges) {
    return t('Discarding changes...');
  }
  if (isPublishing) {
    return t('Publishing...');
  }
  return '';
}

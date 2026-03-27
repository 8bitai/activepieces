import { ColumnDef } from '@tanstack/react-table';
import { t } from 'i18next';
import { BookMarked, EllipsisVertical, MonitorPlay, Tag, Blocks, Clock, ToggleLeft } from 'lucide-react';
import { Dispatch, SetStateAction } from 'react';

import FlowActionMenu from '@/app/components/flow-actions-menu';
import { Button } from '@/components/ui/button';
import { RowDataWithActions } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { TruncatedColumnTextValue } from '@/components/ui/data-table/truncated-column-text-value';
import { FormattedDate } from '@/components/ui/formatted-date';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { FlowLibraryToggle } from '@/features/flows/components/flow-library-toggle';
import { FlowStatusToggle } from '@/features/flows/components/flow-status-toggle';
import { PieceIconList } from '@/features/pieces/components/piece-icon-list';
import { PopulatedFlow } from '@activepieces/shared';

type FlowsTableColumnsProps = {
  refetch: () => void;
  refresh: number;
  setRefresh: Dispatch<SetStateAction<number>>;
  allFlows: PopulatedFlow[];
};

export const flowsTableColumns = ({
  refetch,
  refresh,
  setRefresh,
  allFlows,
}: FlowsTableColumnsProps): (ColumnDef<RowDataWithActions<PopulatedFlow>> & {
  accessorKey: string;
})[] => [
  {
    accessorKey: 'name',
    size: 200,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={t('Name')} icon={Tag} />
    ),
    cell: ({ row }) => {
      const displayName = row.original.version.displayName;
      const isPushedToEmbed = row.original.pushToEmbed;
      return (
        <div className="flex items-center gap-1.5">
          <TruncatedColumnTextValue value={displayName} />
          {isPushedToEmbed && (
            <Tooltip>
              <TooltipTrigger asChild onClick={(e) => e.stopPropagation()}>
                <MonitorPlay className="h-4 w-4 shrink-0 text-primary" />
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t('Pushed to Embed')}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: 'steps',
    size: 150,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={t('Steps')} icon={Blocks} />
    ),
    cell: ({ row }) => {
      return (
        <PieceIconList
          trigger={row.original.version.trigger}
          maxNumberOfIconsToShow={2}
        />
      );
    },
  },
  {
    accessorKey: 'updated',
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={t('Last modified')}
        icon={Clock}
      />
    ),
    cell: ({ row }) => {
      const updated = row.original.updated;
      return (
        <FormattedDate
          date={new Date(updated)}
          className="text-left font-medium"
        />
      );
    },
  },
  {
    accessorKey: 'status',
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={t('Status')}
        icon={ToggleLeft}
      />
    ),
    cell: ({ row }) => {
      return (
        <div
          className="flex items-center space-x-2"
          onClick={(e) => e.stopPropagation()}
        >
          <FlowStatusToggle flow={row.original}></FlowStatusToggle>
        </div>
      );
    },
  },
  {
    accessorKey: 'library',
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={t('Library')}
        icon={BookMarked}
      />
    ),
    cell: ({ row }) => {
      return (
        <div
          className="flex items-center space-x-2"
          onClick={(e) => e.stopPropagation()}
        >
          <FlowLibraryToggle flow={row.original} />
        </div>
      );
    },
  },
  {
    accessorKey: 'actions',
    header: ({ column }) => <DataTableColumnHeader column={column} title="" />,
    cell: ({ row }) => {
      const flow = row.original;
      const isAnotherFlowPushedToEmbed = allFlows.some(
        (f) => f.id !== flow.id && f.pushToEmbed,
      );
      return (
        <div onClick={(e) => e.stopPropagation()}>
          <FlowActionMenu
            insideBuilder={false}
            onVersionsListClick={null}
            flow={flow}
            readonly={false}
            flowVersion={flow.version}
            isAnotherFlowPushedToEmbed={isAnotherFlowPushedToEmbed}
            onRename={() => {
              setRefresh(refresh + 1);
              refetch();
            }}
            onMoveTo={() => {
              setRefresh(refresh + 1);
              refetch();
            }}
            onDuplicate={() => {
              setRefresh(refresh + 1);
              refetch();
            }}
            onDelete={() => {
              setRefresh(refresh + 1);
              refetch();
            }}
            onOwnerChange={() => {
              setRefresh(refresh + 1);
              refetch();
            }}
          >
            <Button variant="ghost" size="icon" className="mr-8">
              <EllipsisVertical className="h-4 w-4" />
            </Button>
          </FlowActionMenu>
        </div>
      );
    },
  },
  {
    accessorKey: 'connectionExternalId',
    enableHiding: true,
  },
];

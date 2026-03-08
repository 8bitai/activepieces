import { ColumnDef } from '@/components/ui/data-table';
import { useQuery } from '@tanstack/react-query';
import { t } from 'i18next';
import {
  Archive,
  ChevronDown,
  Hourglass,
  Workflow,
  Activity,
  Clock,
  Timer,
  AlertTriangle,
  GitBranch,
  ExternalLink,
} from 'lucide-react';
import { Dispatch, SetStateAction, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RowDataWithActions } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { TruncatedColumnTextValue } from '@/components/ui/data-table/truncated-column-text-value';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FormattedDate } from '@/components/ui/formatted-date';
import { StatusIconWithText } from '@/components/ui/status-icon-with-text';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { flowRunsApi } from '@/features/flow-runs/lib/flow-runs-api';
import { flowRunUtils } from '@/features/flow-runs/lib/flow-run-utils';
import { authenticationSession } from '@/lib/authentication-session';
import { formatUtils } from '@/lib/utils';
import { FlowRun, FlowRunStatus, isNil, SeekPage } from '@activepieces/shared';

type SelectedRow = {
  id: string;
  status: FlowRunStatus;
};

type RunsTableColumnsProps = {
  data: SeekPage<FlowRun> | undefined;
  selectedRows: SelectedRow[];
  setSelectedRows: Dispatch<SetStateAction<SelectedRow[]>>;
  selectedAll: boolean;
  setSelectedAll: Dispatch<SetStateAction<boolean>>;
  excludedRows: Set<string>;
  setExcludedRows: Dispatch<SetStateAction<Set<string>>>;
  projectId: string;
};

function FlowsCalledCell({ run, projectId }: { run: FlowRun; projectId: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: childRunsPage, isLoading } = useQuery({
    queryKey: ['flow-run-children', run.id, projectId],
    queryFn: () =>
      flowRunsApi.list({
        projectId,
        parentRunId: run.id,
        limit: 100,
      }),
    enabled: open,
  });
  const childRuns = childRunsPage?.data ?? [];
  const sortedChildRuns = [...childRuns].sort(
    (a, b) =>
      new Date(a.created ?? 0).getTime() - new Date(b.created ?? 0).getTime(),
  );
  const count = sortedChildRuns.length;

  return (
    <div
      className="text-left"
      onClick={(e) => e.stopPropagation()}
      onAuxClick={(e) => e.stopPropagation()}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <GitBranch className="size-4" />
            {open && isLoading
              ? t('Loading...')
              : count > 0
                ? t('{{count}} flow(s) called', { count })
                : t('Flows called')}
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[320px] w-[380px] overflow-y-auto">
          {open && isLoading ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {t('Loading...')}
            </div>
          ) : count === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {t('No subflows called')}
            </div>
          ) : (
            <div className="p-1">
              <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">
                {t('Called in sequence')}
              </div>
              {sortedChildRuns.map((childRun, index) => {
                const duration =
                  childRun.startTime && childRun.finishTime
                    ? new Date(childRun.finishTime).getTime() -
                      new Date(childRun.startTime).getTime()
                    : undefined;
                const { variant, Icon } = flowRunUtils.getStatusIcon(childRun.status);
                return (
                  <div
                    key={childRun.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted/80"
                    onClick={() => {
                      setOpen(false);
                      navigate(
                        authenticationSession.appendProjectRoutePrefix(
                          `/runs/${childRun.id}`,
                        ),
                      );
                    }}
                  >
                    <span className="w-5 shrink-0 text-muted-foreground">
                      {index + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {childRun.flowVersion?.displayName ?? '—'}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <StatusIconWithText
                          icon={Icon}
                          text={formatUtils.convertEnumToReadable(childRun.status)}
                          variant={variant}
                        />
                        {childRun.created && (
                          <FormattedDate
                            date={new Date(childRun.created)}
                            includeTime={true}
                            className="text-xs"
                          />
                        )}
                        {duration !== undefined && (
                          <>
                            <Hourglass className="size-3" />
                            {formatUtils.formatDuration(duration)}
                          </>
                        )}
                      </div>
                    </div>
                    <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                );
              })}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
export const runsTableColumns = ({
  setSelectedRows,
  selectedRows,
  selectedAll,
  setSelectedAll,
  excludedRows,
  setExcludedRows,
  data,
  projectId,
}: RunsTableColumnsProps): ColumnDef<RowDataWithActions<FlowRun>, unknown>[] => [
  {
    id: 'select',
    accessorKey: 'select',
    size: 40,
    minSize: 40,
    maxSize: 40,
    header: ({ table }) => (
      <div className="flex items-center h-full relative">
        <Checkbox
          checked={selectedAll || table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => {
            const isChecked = !!value;
            table.toggleAllPageRowsSelected(isChecked);

            if (isChecked) {
              const currentPageRows = table.getRowModel().rows.map((row) => ({
                id: row.original.id,
                status: row.original.status,
              }));

              setSelectedRows((prev) => {
                const uniqueRows = new Map<string, SelectedRow>([
                  ...prev.map((row) => [row.id, row] as [string, SelectedRow]),
                  ...currentPageRows.map(
                    (row) => [row.id, row] as [string, SelectedRow],
                  ),
                ]);

                return Array.from(uniqueRows.values());
              });
            } else {
              setSelectedAll(false);
              setSelectedRows([]);
              setExcludedRows(new Set());
            }
          }}
        />
        {selectedRows.length > 0 && (
          <div className="absolute left-5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="xs">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="z-50">
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    const currentPageRows = table
                      .getRowModel()
                      .rows.map((row) => ({
                        id: row.original.id,
                        status: row.original.status,
                      }));
                    setSelectedRows(currentPageRows);
                    setSelectedAll(false);
                    setExcludedRows(new Set());
                    table.toggleAllPageRowsSelected(true);
                  }}
                >
                  {t('Select shown')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    if (data?.data) {
                      const allRows = data.data.map((row) => ({
                        id: row.id,
                        status: row.status,
                      }));
                      setSelectedRows(allRows);
                      setSelectedAll(true);
                      setExcludedRows(new Set());
                      table.toggleAllPageRowsSelected(true);
                    }
                  }}
                >
                  {t('Select all')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    ),
    cell: ({ row }) => {
      const isExcluded = excludedRows.has(row.original.id);
      const isSelected = selectedAll
        ? !isExcluded
        : selectedRows.some(
            (selectedRow) => selectedRow.id === row.original.id,
          );

      return (
        <div className="flex items-center h-full">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(value) => {
              const isChecked = !!value;
              if (selectedAll) {
                if (isChecked) {
                  const newExcluded = new Set(excludedRows);
                  newExcluded.delete(row.original.id);
                  setExcludedRows(newExcluded);
                } else {
                  setExcludedRows(new Set([...excludedRows, row.original.id]));
                }
              } else {
                if (isChecked) {
                  setSelectedRows((prev) => [
                    ...prev,
                    {
                      id: row.original.id,
                      status: row.original.status,
                    },
                  ]);
                } else {
                  setSelectedRows((prev) =>
                    prev.filter(
                      (selectedRow) => selectedRow.id !== row.original.id,
                    ),
                  );
                }
              }
              row.toggleSelected(isChecked);
            }}
          />
        </div>
      );
    },
  },
  {
    accessorKey: 'flowId',
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={t('Flow')}
        icon={Workflow}
      />
    ),
    cell: ({ row }) => {
      const { archivedAt, flowVersion } = row.original;
      const displayName = flowVersion?.displayName ?? '—';

      return (
        <div className="flex items-center gap-2 text-left">
          {!isNil(archivedAt) && (
            <Archive className="size-4 text-muted-foreground" />
          )}
          <TruncatedColumnTextValue value={displayName} />
        </div>
      );
    },
  },
  {
    accessorKey: 'status',
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={t('Status')}
        icon={Activity}
      />
    ),
    cell: ({ row }) => {
      const status = row.original.status;
      const { variant, Icon } = flowRunUtils.getStatusIcon(status);
      return (
        <div className="text-left">
          <StatusIconWithText
            icon={Icon}
            text={formatUtils.convertEnumToReadable(status)}
            variant={variant}
          />
        </div>
      );
    },
  },
  {
    accessorKey: 'created',
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={t('Started At')}
        icon={Clock}
      />
    ),
    cell: ({ row }) => {
      return (
        <div className="text-left">
          <FormattedDate
            date={new Date(row.original.created ?? new Date())}
            className="text-left"
            includeTime={true}
          />
        </div>
      );
    },
  },
  {
    accessorKey: 'duration',
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={t('Duration')}
        icon={Timer}
      />
    ),
    cell: ({ row }) => {
      const duration =
        row.original.startTime && row.original.finishTime
          ? new Date(row.original.finishTime).getTime() -
            new Date(row.original.startTime).getTime()
          : undefined;
      const waitDuration =
        row.original.startTime && row.original.created
          ? new Date(row.original.startTime).getTime() -
            new Date(row.original.created).getTime()
          : undefined;

      return (
        <Tooltip>
          <TooltipTrigger>
            <div className="text-left flex items-center gap-2">
              {row.original.finishTime && (
                <>
                  <Hourglass className="h-4 w-4 text-muted-foreground" />
                  {formatUtils.formatDuration(duration)}
                </>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t(
              `Time waited before first execution attempt: ${formatUtils.formatDuration(
                waitDuration,
              )}`,
            )}
          </TooltipContent>
        </Tooltip>
      );
    },
  },
  {
    accessorKey: 'failedStep',
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={t('Failed Step')}
        icon={AlertTriangle}
      />
    ),
    cell: ({ row }) => {
      return (
        <div className="text-left">
          {row.original.failedStep?.displayName ?? '-'}
        </div>
      );
    },
  },
  {
    id: 'flowsCalled',
    accessorKey: 'flowsCalled',
    notClickable: true,
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={t('Flows Called')}
        icon={GitBranch}
      />
    ),
    cell: ({ row }) => (
      <FlowsCalledCell run={row.original} projectId={projectId} />
    ),
  },
];

import { useEmbedding } from '@/components/embed-provider';
import {
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar-shadcn';
import { UserAvatar } from '@/components/ui/user-avatar';
import { userHooks } from '@/hooks/user-hooks';
import { cn } from '@/lib/utils';
import { isNil } from '@activepieces/shared';

export function SidebarUser() {
  const { embedState } = useEmbedding();
  const { state } = useSidebar();
  const { data: user } = userHooks.useCurrentUser();
  const isCollapsed = state === 'collapsed';

  if (!user || (embedState.isEmbedded && embedState.hideSideNav)) {
    return null;
  }

  const displayName = user.firstName + ' ' + user.lastName;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex items-center gap-2 px-2 py-1.5 min-h-10 w-full cursor-default">
          <div className="size-6 shrink-0 overflow-hidden flex items-center justify-center rounded-full">
            <UserAvatar
              className={cn('size-full object-cover', {
                'scale-150': isNil(user.imageUrl),
              })}
              name={displayName}
              email={user.email}
              imageUrl={user.imageUrl}
              size={24}
              disableTooltip={true}
            />
          </div>
          {!isCollapsed && (
            <span className="truncate text-sm">{displayName}</span>
          )}
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

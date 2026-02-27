import { useTranslation } from 'react-i18next';
import { Navigate, useParams, useLocation } from 'react-router-dom';

import { PageTitle } from '@/app/components/page-title';
import { ProjectDashboardLayout } from '@/app/components/project-layout';
import { TemplateDetailsPage } from '@/app/routes/templates/id';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { ShareTemplate } from '@/features/templates/components/share-template';
import { templatesHooks } from '@/features/templates/hooks/templates-hook';
import { authenticationSession } from '@/lib/authentication-session';
import { FROM_QUERY_PARAM } from '@/lib/navigation-utils';
import { TemplateType, isNil } from '@activepieces/shared';

const TemplateDetailsWrapper = () => {
  const { templateId } = useParams<{ templateId: string }>();
  const location = useLocation();
  const { t } = useTranslation();
  const { data: template, isLoading, isError } = templatesHooks.useTemplate(templateId!);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8 text-center h-screen">
        <p className="text-muted-foreground">
          {t('Template could not be loaded.')}
        </p>
      </div>
    );
  }

  if (!template) {
    return <Navigate to="/templates" replace />;
  }

  const token = authenticationSession.getToken();
  const isNotAuthenticated = isNil(token);
  const useProjectLayout = template.type !== TemplateType.SHARED;

  if (isNotAuthenticated && useProjectLayout) {
    return (
      <Navigate
        to={`/sign-in?${FROM_QUERY_PARAM}=${location.pathname}${location.search}`}
        replace
      />
    );
  }

  const content = (
    <PageTitle title={template.name}>
      <TemplateDetailsPage template={template} />
    </PageTitle>
  );

  if (useProjectLayout) {
    return <ProjectDashboardLayout>{content}</ProjectDashboardLayout>;
  }

  return <ShareTemplate template={template} />;
};

export { TemplateDetailsWrapper };

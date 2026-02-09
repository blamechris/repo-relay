/**
 * Workflow template builder for repo-relay setup wizard
 */
export interface ProjectFeatures {
    issues: boolean;
    releases: boolean;
    deployments: boolean;
    reviewPolling: boolean;
    pushEvents: boolean;
}
export declare function buildWorkflowTemplate(ciWorkflowName: string, features: ProjectFeatures): string;
//# sourceMappingURL=workflow-template.d.ts.map
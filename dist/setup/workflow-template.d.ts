/**
 * Workflow template builder for repo-relay setup wizard
 */
export interface ProjectFeatures {
    issues: boolean;
    releases: boolean;
    deployments: boolean;
}
export declare function buildWorkflowTemplate(ciWorkflowName: string, features: ProjectFeatures): string;
//# sourceMappingURL=workflow-template.d.ts.map
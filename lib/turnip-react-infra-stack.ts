import * as cdk from 'aws-cdk-lib';
import {aws_certificatemanager as acm, aws_ecr, aws_route53, RemovalPolicy} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {GithubActionsIdentityProvider, GithubActionsRole} from "aws-cdk-github-oidc";
import {AlbFargate} from "./constructs/alb-fargate";
import {Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";

export class TurnipReactInfraStack extends cdk.Stack {
    public readonly loadBalancedFargateService: AlbFargate;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        if (!props) {
            props = {
                // this is usually us-west-2
                env: {region: process.env.CDK_DEFAULT_REGION}
            };
        }

        super(scope, id, props);

        const repository = new aws_ecr.Repository(this, 'turnip-react');

        // References
        // https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services#adding-the-identity-provider-to-aws
        // https://aws.amazon.com/blogs/security/use-iam-roles-to-connect-github-actions-to-actions-in-aws/
        // https://constructs.dev/packages/aws-cdk-github-oidc/v/2.4.1?lang=typescript
        const provider = new GithubActionsIdentityProvider(this, "GithubProvider");

        const infraGithubActionRole = new GithubActionsRole(this, "CDKGithubActionRole", {
            provider: provider,
            owner: "TurnipXenon",
            repo: "turnip-react-infra",
        });

        const logicGithubActionRole = new GithubActionsRole(this, "LogicGithubActionRole", {
            provider: provider,
            owner: "TurnipXenon",
            repo: "turnip-react",
        });

        repository.grantPush(logicGithubActionRole);

        // todo: organize better
        // todo: add route53 to connect to the alb
        // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_route53-readme.html#amazon-route53-construct-library
        const domain = 'turnipxenon.com';
        const hostedZone = new aws_route53.PublicHostedZone(this, 'TurnipXenonHostedZone', {
            zoneName: domain,
        });
        hostedZone.applyRemovalPolicy(RemovalPolicy.RETAIN);

        // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager.Certificate.html#example
        const certificate = new acm.Certificate(this, "Certificate", {
            domainName: domain,
            validation: acm.CertificateValidation.fromDns(hostedZone)
        });

        // to be used for all ECS Fargate services to connect with a repository in ECR
        const taskExecutionRole = new Role(this, 'ECSFargateExecutionRole', {
            assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com")
        });
        repository.grantRead(taskExecutionRole);
        repository.grantPull(taskExecutionRole);

        // todo https://www.reddit.com/r/aws/comments/11g98us/aws_noob_cdkarchitecture_question_for_node_backend/
        // todo: also move from porkbun to r53 as authortitative
        this.loadBalancedFargateService = new AlbFargate(this, 'TurnipReact', {
            repository,
            taskExecutionRole,
            hostedZone,
            domain,
            certificate
        });

        // todo: albfarate target group configure health check
    }
}

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';

export class MusicanatorBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Table
    const table = new dynamodb.Table(this, 'UsersTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // Lambda Function (no Docker, no NodejsFunction)
    const lambdaFn = new lambda.Function(this, 'PlaylistLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')), // JS build folder
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        GEMINI_API_KEY: '',
        SPOTIFY_CLIENT_ID: 'c62d2aabf1a94b948f2566409145daec',
        SPOTIFY_CLIENT_SECRET: '',
        SPOTIFY_ACCESS_TOKEN: '',
        SPOTIFY_REFRESH_TOKEN: '',
      },
    });

    table.grantReadWriteData(lambdaFn);

    // API Gateway
    new apigw.LambdaRestApi(this, 'PlaylistApi', {
      handler: lambdaFn,
      proxy: true,
    });
  }
}





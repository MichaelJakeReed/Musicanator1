#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MusicanatorBackendStack } from '../lib/musicanator-backend-stack';

const app = new cdk.App();
new MusicanatorBackendStack(app, 'MusicanatorBackendStack', {
  env: { region: 'us-east-1' },
});


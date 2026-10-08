'use strict';

// The single named surface for every model-backed (LLM) call this CLI makes (talents-ai-score, arch-cleanup #4).

const agentSynthesis = require('./agent-synthesis');
const agentEvaluation = require('./agent-evaluation');
const roadmapPersonalization = require('./roadmap-personalization');
const onboardingClient = require('./onboarding-client');
const config = require('./config');

// The model calls, one entry each, paired with the request-builder, endpoint-getter and promptVersion pointer that define them. The skill-code certify/interview trio was removed when `certify` became a dimension LiveKit interview (its turns run over the onboarding HTTP/LiveKit surface, not a dedicated model call here).
const AI_CALLS = Object.freeze({
  agentSynthesis: {
    call: agentSynthesis.requestAgentSynthesis,
    build: agentSynthesis.buildSynthesisRequest,
    endpoint: config.getSynthesisEndpoint,
    promptVersion: null,
  },
  agentEvaluation: {
    call: agentEvaluation.requestAgentEvaluation,
    build: agentEvaluation.buildAgentEvaluationRequest,
    endpoint: config.getAgentEvaluationEndpoint,
    promptVersion: agentEvaluation.PROMPT_VERSION,
  },
  roadmapPersonalization: {
    call: roadmapPersonalization.requestRoadmapPersonalization,
    build: roadmapPersonalization.buildRoadmapPersonalizationRequest,
    endpoint: config.getRoadmapEndpoint,
    promptVersion: null,
  },
  onboardingOpen: {
    call: onboardingClient.requestStartTextSession,
    build: null,
    endpoint: config.getOnboardingInterviewsEndpoint,
    promptVersion: null,
  },
  onboardingTurn: {
    call: onboardingClient.requestOnboardingTurn,
    build: null,
    endpoint: config.getOnboardingInterviewsEndpoint,
    promptVersion: null,
  },
  onboardingComplete: {
    call: onboardingClient.requestCompleteTextSession,
    build: null,
    endpoint: config.getOnboardingInterviewsEndpoint,
    promptVersion: null,
  },
});

module.exports = {
  AI_CALLS,

  requestAgentSynthesis: agentSynthesis.requestAgentSynthesis,
  buildSynthesisRequest: agentSynthesis.buildSynthesisRequest,

  requestAgentEvaluation: agentEvaluation.requestAgentEvaluation,
  buildAgentEvaluationRequest: agentEvaluation.buildAgentEvaluationRequest,

  requestRoadmapPersonalization: roadmapPersonalization.requestRoadmapPersonalization,
  buildRoadmapPersonalizationRequest: roadmapPersonalization.buildRoadmapPersonalizationRequest,

  requestStartTextSession: onboardingClient.requestStartTextSession,
  requestOnboardingTurn: onboardingClient.requestOnboardingTurn,
  requestCompleteTextSession: onboardingClient.requestCompleteTextSession,
};

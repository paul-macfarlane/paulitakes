import { AgentOperation } from "@/lib/agent/contract";
import {
  handleAgentRequest,
  unsupportedAgentMethod,
} from "@/lib/agent/service";

export async function GET(request: Request) {
  return handleAgentRequest(request, AgentOperation.List);
}
export function POST() {
  return unsupportedAgentMethod("GET");
}
export function PUT() {
  return unsupportedAgentMethod("GET");
}
export function PATCH() {
  return unsupportedAgentMethod("GET");
}
export function DELETE() {
  return unsupportedAgentMethod("GET");
}
export function HEAD() {
  return unsupportedAgentMethod("GET");
}
export function OPTIONS() {
  return unsupportedAgentMethod("GET");
}

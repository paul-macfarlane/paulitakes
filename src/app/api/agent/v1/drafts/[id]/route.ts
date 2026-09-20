import { AgentOperation } from "@/lib/agent/contract";
import {
  handleAgentRequest,
  unsupportedAgentMethod,
} from "@/lib/agent/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleAgentRequest(request, AgentOperation.Read, params);
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

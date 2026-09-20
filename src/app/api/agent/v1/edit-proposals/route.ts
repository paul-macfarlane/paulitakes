import { AgentOperation } from "@/lib/agent/contract";
import {
  handleAgentRequest,
  unsupportedAgentMethod,
} from "@/lib/agent/service";

export async function POST(request: Request) {
  return handleAgentRequest(request, AgentOperation.Submit);
}
export function GET() {
  return unsupportedAgentMethod("POST");
}
export function PUT() {
  return unsupportedAgentMethod("POST");
}
export function PATCH() {
  return unsupportedAgentMethod("POST");
}
export function DELETE() {
  return unsupportedAgentMethod("POST");
}
export function HEAD() {
  return unsupportedAgentMethod("POST");
}
export function OPTIONS() {
  return unsupportedAgentMethod("POST");
}

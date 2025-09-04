export interface EtherscanApiResponse {
  status: string;
  message: string;
  result: string;
}

export interface EtherscanErrorResponse {
  status: string;
  message: string;
  result: string;
}

export type EtherscanResponse = EtherscanApiResponse | EtherscanErrorResponse;

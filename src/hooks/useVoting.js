// src/hooks/useVoting.js - Enhanced version with improved contract connection
import { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../contexts/Web3Context';
import { useBlockchainData } from '../contexts/BlockchainDataContext';
import { VOTE_TYPES } from '../utils/constants';
import blockchainDataCache from '../utils/blockchainDataCache';

// Debug flag - set to true to enable detailed logging
const DEBUG = true;

export function useVoting() {
  const { contracts, account, isConnected, contractsReady, provider } = useWeb3();
  const { hasVoted: contextHasVoted, getProposalVoteTotals: contextGetVoteTotals, refreshData } = useBlockchainData();
  
  const [voting, setVoting] = useState({
    loading: false,
    processing: false,
    error: null,
    success: false,
    lastVotedProposalId: null
  });

  // Helper function for debug logging
  const logDebug = (...args) => {
    if (DEBUG) {
      console.log('[VotingHook]', ...args);
    }
  };
  
  // Log contract readiness
  useEffect(() => {
    logDebug('Contracts ready:', contractsReady);
    if (contractsReady && contracts) {
      logDebug('Governance contract available:', !!contracts.governance);
      logDebug('Token contract available:', !!contracts.justToken);
    }
  }, [contractsReady, contracts]);
  
  // Validate connection to governance contract
  const validateGovernanceContract = useCallback(() => {
    if (!contractsReady || !contracts || !contracts.governance) {
      logDebug('Governance contract not available');
      return false;
    }
    
    // Check if the contract has the expected methods
    if (!contracts.governance.getProposalVoteTotals || 
        !contracts.governance.getProposalState) {
      logDebug('Governance contract missing required methods');
      return false;
    }
    
    return true;
  }, [contractsReady, contracts]);
  
  // Get the snapshot ID for a proposal using events
  const getProposalSnapshotId = useCallback(async (proposalId) => {
    if (!validateGovernanceContract()) return 0;
    
    try {
      // Try to get from cache first
      const cacheKey = `snapshot-${proposalId}`;
      const cachedId = blockchainDataCache.get(cacheKey);
      if (cachedId !== null) {
        logDebug(`Using cached snapshot ID for proposal #${proposalId}: ${cachedId}`);
        return cachedId;
      }
      
      logDebug(`Fetching snapshot ID for proposal #${proposalId}`);
      
      // Try to find the creation event for this proposal
      const filter = contracts.governance.filters.ProposalEvent(proposalId, 0); // Type 0 is creation event
      const events = await contracts.governance.queryFilter(filter);
      
      if (events.length > 0) {
        const creationEvent = events[0];
        
        // Try to decode the data which contains type and snapshotId
        try {
          const data = creationEvent.args.data;
          const decoded = ethers.utils.defaultAbiCoder.decode(['uint8', 'uint256'], data);
          const snapshotId = decoded[1].toNumber(); // The snapshotId is the second parameter
          
          // Cache the result with a long TTL since this never changes
          blockchainDataCache.set(cacheKey, snapshotId, 86400 * 30); // 30 days
          
          logDebug(`Found snapshot ID for proposal #${proposalId}: ${snapshotId}`);
          return snapshotId;
        } catch (decodeErr) {
          console.warn("Couldn't decode event data for snapshot ID:", decodeErr);
        }
      } else {
        logDebug(`No creation events found for proposal #${proposalId}`);
      }
      
      // If we can't get it from events, try to get the current snapshot as fallback
      if (contracts.justToken) {
        try {
          const currentSnapshot = await contracts.justToken.getCurrentSnapshotId();
          logDebug(`Using current snapshot ID as fallback: ${currentSnapshot}`);
          
          // Cache the result with a shorter TTL since it's a fallback
          blockchainDataCache.set(cacheKey, currentSnapshot, 86400); // 1 day
          
          return currentSnapshot;
        } catch (tokenErr) {
          console.error("Error getting current snapshot from token contract:", tokenErr);
        }
      }
      
      // Last resort fallback
      return 0;
    } catch (err) {
      console.warn("Error getting proposal snapshot ID:", err);
      // Return a fallback value
      return 0;
    }
  }, [contracts, validateGovernanceContract]);

  // Check if user has voted on a specific proposal
  const hasVoted = useCallback(async (proposalId) => {
    if (!validateGovernanceContract() || !account) return false;
    
    try {
      // Try to get from cache first
      const cacheKey = `hasVoted-${account}-${proposalId}`;
      const cachedResult = blockchainDataCache.get(cacheKey);
      if (cachedResult !== null) {
        return cachedResult;
      }
      
      // Try direct method first
      try {
        const voterInfo = await contracts.governance.proposalVoterInfo(proposalId, account);
        const hasVoted = !voterInfo.isZero();
        
        // Cache the result
        blockchainDataCache.set(cacheKey, hasVoted, 86400 * 7); // 7 days
        
        logDebug(`Direct check if user has voted on #${proposalId}: ${hasVoted}`);
        return hasVoted;
      } catch (directErr) {
        logDebug(`Error with direct vote check, falling back to context: ${directErr.message}`);
        
        // Fallback to context method
        const contextResult = await contextHasVoted(proposalId);
        blockchainDataCache.set(cacheKey, contextResult, 86400); // 1 day (shorter TTL for fallback)
        return contextResult;
      }
    } catch (err) {
      console.error(`Error checking if voted on proposal ${proposalId}:`, err);
      return false;
    }
  }, [validateGovernanceContract, contracts, account, contextHasVoted]);
  
  // Get the voting power of the user for a specific snapshot
  const getVotingPower = useCallback(async (snapshotId) => {
    if (!isConnected || !contractsReady || !account || !contracts.justToken) {
      logDebug('Cannot get voting power - prerequisites not met');
      return "0";
    }
    
    try {
      // Try to get from cache first
      const cacheKey = `votingPower-${account}-${snapshotId}`;
      const cachedPower = blockchainDataCache.get(cacheKey);
      if (cachedPower !== null) {
        return cachedPower;
      }
      
      logDebug(`Getting voting power for account ${account} at snapshot ${snapshotId}`);
      
      // If no snapshot ID is provided, get the current one
      let actualSnapshotId = snapshotId;
      
      if (!actualSnapshotId) {
        try {
          actualSnapshotId = await contracts.justToken.getCurrentSnapshotId();
          logDebug(`Using current snapshot ID: ${actualSnapshotId}`);
        } catch (snapshotErr) {
          console.error("Error getting current snapshot ID:", snapshotErr);
          return "0";
        }
      }
      
      // Try getEffectiveVotingPower method first (most accurate)
      try {
        const votingPower = await contracts.justToken.getEffectiveVotingPower(account, actualSnapshotId);
        const formattedPower = ethers.utils.formatEther(votingPower);
        
        logDebug(`Voting power at snapshot ${actualSnapshotId}: ${formattedPower}`);
        
        // Cache the result with a long TTL since historical snapshots never change
        blockchainDataCache.set(cacheKey, formattedPower, 86400 * 30); // 30 days
        
        return formattedPower;
      } catch (powerErr) {
        console.error("Error getting effective voting power:", powerErr);
        
        // Fallback: try to get balance at snapshot
        try {
          const balance = await contracts.justToken.balanceOfAt(account, actualSnapshotId);
          const formattedBalance = ethers.utils.formatEther(balance);
          
          logDebug(`Fallback - balance at snapshot ${actualSnapshotId}: ${formattedBalance}`);
          
          // Cache with shorter TTL since it's a fallback
          blockchainDataCache.set(cacheKey, formattedBalance, 86400); // 1 day
          
          return formattedBalance;
        } catch (balanceErr) {
          console.error("Error getting balance at snapshot:", balanceErr);
          return "0";
        }
      }
    } catch (err) {
      console.error("Error getting voting power:", err);
      return "0";
    }
  }, [contracts, account, isConnected, contractsReady]);
  
  // Get detailed information about how a user voted on a proposal
  const getVoteDetails = useCallback(async (proposalId) => {
    if (!validateGovernanceContract() || !account) {
      return { hasVoted: false, votingPower: "0", voteType: null };
    }
    
    try {
      // Try to get from cache first
      const cacheKey = `voteDetails-${account}-${proposalId}`;
      const cachedDetails = blockchainDataCache.get(cacheKey);
      if (cachedDetails !== null) {
        return cachedDetails;
      }
      
      logDebug(`Getting vote details for proposal #${proposalId}, account ${account}`);
      
      // First check if the user has voted using proposalVoterInfo
      let voterInfo;
      try {
        voterInfo = await contracts.governance.proposalVoterInfo(proposalId, account);
      } catch (voterInfoErr) {
        console.error(`Error getting voter info for proposal ${proposalId}:`, voterInfoErr);
        return { hasVoted: false, votingPower: "0", voteType: null };
      }
      
      if (voterInfo.isZero()) {
        const result = { hasVoted: false, votingPower: "0", voteType: null };
        blockchainDataCache.set(cacheKey, result, 86400); // 1 day
        return result;
      }
      
      // User has voted, get the voting power
      const votingPower = ethers.utils.formatEther(voterInfo);
      
      // Try to determine how they voted by checking events
      let voteType = null;
      
      try {
        // Check for VoteCast events for this proposal and user
        const filter = contracts.governance.filters.VoteCast(proposalId, account);
        const events = await contracts.governance.queryFilter(filter);
        
        if (events.length > 0) {
          // Use the most recent vote event
          const latestEvent = events[events.length - 1];
          voteType = parseInt(latestEvent.args.support);
          logDebug(`Found vote type from events: ${voteType}`);
        } else {
          logDebug(`No VoteCast events found for proposal #${proposalId}, account ${account}`);
        }
      } catch (eventsErr) {
        console.warn("Couldn't determine vote type from events:", eventsErr);
      }
      
      const result = {
        hasVoted: true,
        votingPower: votingPower,
        voteType: voteType
      };
      
      // Cache the result with a long TTL since votes can't be changed
      blockchainDataCache.set(cacheKey, result, 86400 * 30); // 30 days
      
      return result;
    } catch (err) {
      console.error("Error getting vote details:", err);
      return { hasVoted: false, votingPower: "0", voteType: null };
    }
  }, [validateGovernanceContract, contracts, account]);

  // Direct contract call to getProposalVoteTotals with improved error handling
  const getProposalVoteTotalsFromContract = useCallback(async (proposalId) => {
    if (!validateGovernanceContract()) {
      return null;
    }
    
    try {
      logDebug(`Direct contract call to getProposalVoteTotals for #${proposalId}`);
      
      // Directly call the contract method to get voting power values
      // This should work for all proposal states
      const [forVotes, againstVotes, abstainVotes, totalVotingPower, voterCount] = 
        await contracts.governance.getProposalVoteTotals(proposalId);
      
      // Convert BigNumber values to formatted strings (representing JST tokens)
      const result = {
        yesVotes: ethers.utils.formatEther(forVotes),
        noVotes: ethers.utils.formatEther(againstVotes),
        abstainVotes: ethers.utils.formatEther(abstainVotes),
        totalVotingPower: ethers.utils.formatEther(totalVotingPower),
        totalVoters: voterCount.toNumber(),
        source: 'direct-contract-call'
      };
      
      // Calculate percentages
      if (!totalVotingPower.isZero()) {
        result.yesPercentage = parseFloat(forVotes.mul(10000).div(totalVotingPower)) / 100;
        result.noPercentage = parseFloat(againstVotes.mul(10000).div(totalVotingPower)) / 100;
        result.abstainPercentage = parseFloat(abstainVotes.mul(10000).div(totalVotingPower)) / 100;
      } else {
        result.yesPercentage = 0;
        result.noPercentage = 0;
        result.abstainPercentage = 0;
      }
      
      // Additional fields for compatibility
      result.yesVotingPower = result.yesVotes;
      result.noVotingPower = result.noVotes;
      result.abstainVotingPower = result.abstainVotes;
      
      logDebug('Contract returned vote data:', result);
      
      return result;
    } catch (error) {
      console.error(`Error in direct contract call to getProposalVoteTotals for #${proposalId}:`, error);
      return null;
    }
  }, [validateGovernanceContract, contracts]);
  
  // Enhanced getProposalVoteTotals function with robustness enhancements
  const getProposalVoteTotals = useCallback(async (proposalId) => {
    if (!validateGovernanceContract()) {
      logDebug('Cannot get vote totals - contract validation failed');
      return createEmptyVoteData('not-connected');
    }
    
    try {
      logDebug(`Fetching vote totals for proposal ${proposalId}`);
      
      // Try to get from cache first to avoid excessive blockchain queries
      const cacheKey = `voteTotals-${proposalId}`;
      const cachedData = blockchainDataCache.get(cacheKey);
      if (cachedData !== null) {
        logDebug(`Using cached vote data for proposal #${proposalId}`);
        return cachedData;
      }
      
      // First check proposal state to set appropriate caching strategy
      let proposalState;
      try {
        proposalState = await contracts.governance.getProposalState(proposalId);
        logDebug(`Proposal ${proposalId} state: ${proposalState}`);
      } catch (stateErr) {
        console.warn(`Couldn't determine state for proposal ${proposalId}:`, stateErr);
        proposalState = null;
      }
      
      // Make direct contract call to get vote totals - primary method
      const directContractData = await getProposalVoteTotalsFromContract(proposalId);
      
      if (directContractData) {
        // Add state and timestamp to the result
        directContractData.proposalState = proposalState !== null ? Number(proposalState) : null;
        directContractData.fetchedAt = Date.now();
        
        // Set TTL based on proposal state - longer cache for inactive proposals
        let ttlSeconds = 300; // Default 5 minutes for active proposals
        
        if (proposalState !== null && proposalState !== 0) { // 0 = Active
          // For non-active proposals (completed, expired, etc.), use a much longer TTL
          ttlSeconds = 86400 * 30; // 30 days cache for completed proposals
        }
        
        // Cache the result with appropriate TTL
        blockchainDataCache.set(cacheKey, directContractData, ttlSeconds);
        
        return directContractData;
      }
      
      // If direct contract call failed, try context method
      logDebug('Direct contract call failed, trying context method');
      try {
        if (contextGetVoteTotals) {
          const contextData = await contextGetVoteTotals(proposalId);
          
          if (contextData) {
            // Process the data consistently
            const processedData = {
              yesVotes: contextData.yesVotes || "0",
              noVotes: contextData.noVotes || "0",
              abstainVotes: contextData.abstainVotes || "0",
              yesVotingPower: contextData.yesVotes || contextData.yesVotingPower || "0",
              noVotingPower: contextData.noVotes || contextData.noVotingPower || "0",
              abstainVotingPower: contextData.abstainVotes || contextData.abstainVotingPower || "0",
              totalVoters: parseInt(contextData.totalVoters) || 0,
              proposalState: proposalState !== null ? Number(proposalState) : null,
              fetchedAt: Date.now(),
              source: 'context-method'
            };
            
            // Calculate total voting power
            const totalVotingPower = 
              parseFloat(processedData.yesVotingPower) + 
              parseFloat(processedData.noVotingPower) + 
              parseFloat(processedData.abstainVotingPower);
            
            processedData.totalVotingPower = totalVotingPower.toString();
            
            // Calculate percentages
            if (totalVotingPower > 0) {
              processedData.yesPercentage = (parseFloat(processedData.yesVotingPower) / totalVotingPower) * 100;
              processedData.noPercentage = (parseFloat(processedData.noVotingPower) / totalVotingPower) * 100;
              processedData.abstainPercentage = (parseFloat(processedData.abstainVotingPower) / totalVotingPower) * 100;
            } else {
              processedData.yesPercentage = 0;
              processedData.noPercentage = 0;
              processedData.abstainPercentage = 0;
            }
            
            // Cache with appropriate TTL
            const ttlSeconds = (proposalState !== null && proposalState !== 0) ? 86400 * 7 : 300;
            blockchainDataCache.set(cacheKey, processedData, ttlSeconds);
            
            return processedData;
          }
        }
      } catch (contextErr) {
        console.error(`Error using context method for proposal ${proposalId}:`, contextErr);
      }
      
      // If all direct methods fail, try to get vote data from events
      logDebug('All direct methods failed, trying event-based method');
      try {
        const eventData = await getIndexedVoteData(proposalId);
        if (eventData) {
          return eventData;
        }
      } catch (eventErr) {
        console.error(`Error using event-based method for proposal ${proposalId}:`, eventErr);
      }
      
      // Last resort: create empty data structure
      const emptyData = createEmptyVoteData('all-methods-failed');
      // Still cache it to prevent hammering the contract with failed calls
      blockchainDataCache.set(cacheKey, emptyData, 60); // Short TTL (1 minute) for error cases
      
      return emptyData;
    } catch (error) {
      console.error(`Error in getProposalVoteTotals for ${proposalId}:`, error);
      return createEmptyVoteData('error');
    }
  }, [validateGovernanceContract, contracts, getProposalVoteTotalsFromContract, contextGetVoteTotals]);
  
  // Helper function to create empty vote data with a source
  const createEmptyVoteData = (source) => {
    return {
      yesVotes: "0",
      noVotes: "0",
      abstainVotes: "0",
      totalVoters: 0,
      yesPercentage: 0,
      noPercentage: 0,
      abstainPercentage: 0,
      yesVotingPower: "0",
      noVotingPower: "0",
      abstainVotingPower: "0",
      totalVotingPower: "0",
      fetchedAt: Date.now(),
      source: source
    };
  };
  
  // Get vote data using event indexing (backup method)
  const getIndexedVoteData = useCallback(async (proposalId) => {
    if (!validateGovernanceContract()) return null;
    
    try {
      // Try to get from cache first
      const cacheKey = `indexedVotes-${proposalId}`;
      const cachedData = blockchainDataCache.get(cacheKey);
      if (cachedData !== null) {
        return cachedData;
      }
      
      logDebug(`Getting indexed vote data from events for proposal #${proposalId}`);
      
      // Get all VoteCast events for this proposal
      const filter = contracts.governance.filters.VoteCast(proposalId);
      const events = await contracts.governance.queryFilter(filter);
      
      if (events.length === 0) {
        logDebug(`No VoteCast events found for proposal #${proposalId}`);
        return null;
      }
      
      logDebug(`Found ${events.length} VoteCast events for proposal #${proposalId}`);
      
      // Use maps to track the latest vote for each voter
      const voterVotes = new Map(); // address -> {type, power}
      
      // Process all events to build an accurate picture
      for (const event of events) {
        const { voter, support, votingPower } = event.args;
        const voterAddress = voter.toLowerCase();
        const powerValue = ethers.utils.formatEther(votingPower);
        
        // Store or update this voter's vote (only most recent)
        voterVotes.set(voterAddress, {
          type: Number(support),
          power: powerValue
        });
      }
      
      // Count voters and voting power by type
      let votesByType = {0: 0, 1: 0, 2: 0}; // Counts
      let votingPowerByType = {0: 0, 1: 0, 2: 0}; // Power
      
      for (const [, voteData] of voterVotes.entries()) {
        const { type, power } = voteData;
        votesByType[type]++;
        votingPowerByType[type] += parseFloat(power);
      }
      
      // Calculate totals
      const totalVotes = votesByType[0] + votesByType[1] + votesByType[2];
      const totalVotingPower = votingPowerByType[0] + votingPowerByType[1] + votingPowerByType[2];
      
      const result = {
        // Vote counts (1 per person)
        yesVotes: votingPowerByType[1].toString(),
        noVotes: votingPowerByType[0].toString(),
        abstainVotes: votingPowerByType[2].toString(),
        totalVotes,
        
        // Voting power
        yesVotingPower: votingPowerByType[1].toString(),
        noVotingPower: votingPowerByType[0].toString(),
        abstainVotingPower: votingPowerByType[2].toString(),
        totalVotingPower: totalVotingPower.toString(),
        
        // Total unique voters
        totalVoters: voterVotes.size,
        
        // Percentages based on voting power (not vote counts)
        yesPercentage: totalVotingPower > 0 ? (votingPowerByType[1] / totalVotingPower) * 100 : 0,
        noPercentage: totalVotingPower > 0 ? (votingPowerByType[0] / totalVotingPower) * 100 : 0,
        abstainPercentage: totalVotingPower > 0 ? (votingPowerByType[2] / totalVotingPower) * 100 : 0,
        
        // Timestamp for cache management
        fetchedAt: Date.now(),
        
        // Flag for source of data
        source: 'events'
      };
      
      // Set a long cache TTL for event-based data for completed proposals
      // Try to determine proposal state for better caching
      let ttlSeconds = 3600; // Default 1 hour
      
      try {
        const proposalState = await contracts.governance.getProposalState(proposalId);
        if (proposalState !== 0) { // Not active
          ttlSeconds = 86400 * 30; // 30 days for inactive proposals
        }
      } catch (stateErr) {
        // If we can't determine state, use a medium TTL
        ttlSeconds = 86400; // 1 day
      }
      
      // Cache the result with appropriate TTL
      blockchainDataCache.set(cacheKey, result, ttlSeconds);
      
      return result;
    } catch (error) {
      console.error("Error indexing vote data:", error);
      return null;
    }
  }, [validateGovernanceContract, contracts]);
  
  // Try to initialize vote data at hook mount
  useEffect(() => {
    if (validateGovernanceContract()) {
      logDebug('Valid governance contract detected');
    } else {
      console.warn('Governance contract validation failed - vote data may not be available');
    }
  }, [validateGovernanceContract]);

  // Cast a vote using blockchain and handle state changes
  const castVote = async (proposalId, voteType) => {
    if (!validateGovernanceContract()) {
      throw new Error("Governance contract not available or initialized");
    }
    
    if (!isConnected) {
      throw new Error("Not connected to blockchain");
    }
    
    try {
      setVoting({ 
        loading: true,
        processing: true,
        error: null, 
        success: false,
        lastVotedProposalId: null
      });
      
      logDebug(`Casting vote on proposal #${proposalId} with vote type ${voteType}`);
      
      // Validate vote type
      if (![VOTE_TYPES.AGAINST, VOTE_TYPES.FOR, VOTE_TYPES.ABSTAIN].includes(Number(voteType))) {
        throw new Error("Invalid vote type. Must be 0 (Against), 1 (For), or 2 (Abstain)");
      }
      
      // Check if the user has already voted on the blockchain
      const hasAlreadyVoted = await hasVoted(proposalId);
      if (hasAlreadyVoted) {
        throw new Error("You have already voted on this proposal");
      }
      
      // Check if the proposal is active
      const proposalState = await contracts.governance.getProposalState(proposalId);
      if (proposalState !== 0) { // 0 = Active
        throw new Error("Proposal is not active. Cannot vote on inactive proposals.");
      }
      
      // Get the snapshot ID
      const snapshotId = await getProposalSnapshotId(proposalId);
      
      // Check if the user has any voting power
      const votingPower = await contracts.justToken.getEffectiveVotingPower(account, snapshotId);
      const votingPowerFormatted = ethers.utils.formatEther(votingPower);
      
      if (votingPower.isZero()) {
        throw new Error("You don't have any voting power for this proposal. You may need to delegate to yourself or acquire tokens before the snapshot.");
      }
      
      logDebug(`Casting vote with ${votingPowerFormatted} voting power`);
      
      // Cast the vote with proper gas limit to prevent issues
      const gasLimit = await contracts.governance.estimateGas.castVote(proposalId, voteType)
        .catch(() => ethers.BigNumber.from(300000)); // Fallback gas limit
      
      const tx = await contracts.governance.castVote(proposalId, voteType, {
        gasLimit: gasLimit.mul(120).div(100) // Add 20% buffer
      });
      
      // Wait for transaction to be confirmed
      const receipt = await tx.wait();
      logDebug("Vote transaction confirmed:", receipt.transactionHash);
      
      // Clear cache entries related to this proposal and user's votes
      blockchainDataCache.delete(`hasVoted-${account}-${proposalId}`);
      blockchainDataCache.delete(`voteDetails-${account}-${proposalId}`);
      blockchainDataCache.delete(`voteTotals-${proposalId}`);
      blockchainDataCache.delete(`dashboard-votes-${proposalId}`);
      blockchainDataCache.delete(`indexedVotes-${proposalId}`);
      
      // Refresh blockchain data to update state
      refreshData();
      
      // Wait briefly to allow the blockchain to update
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setVoting({ 
        loading: false,
        processing: false, 
        error: null, 
        success: true,
        lastVotedProposalId: proposalId
      });
      
      return {
        success: true,
        votingPower: votingPowerFormatted,
        voteType,
        transactionHash: receipt.transactionHash
      };
    } catch (err) {
      console.error("Error casting vote:", err);
      const errorMessage = err.reason || err.message || "Unknown error";
      
      setVoting({ 
        loading: false,
        processing: false,
        error: errorMessage, 
        success: false,
        lastVotedProposalId: null
      });
      
      throw err;
    }
  };

  return {
    castVote,
    hasVoted,
    getVotingPower,
    getVoteDetails,
    getProposalVoteTotals,
    getProposalVoteTotalsFromContract, // Expose the direct method for debugging
    getIndexedVoteData,
    voting,
    contractReady: validateGovernanceContract()
  };
}

// Also export as default for components using default import
export default useVoting;
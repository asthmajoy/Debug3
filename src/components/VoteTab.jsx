import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import useGovernanceParams from '../hooks/useGovernanceParams';
import { Clock, Check, X, X as XIcon, Calendar, Users, BarChart2, Settings, Info, HelpCircle } from 'lucide-react';
import { PROPOSAL_STATES, VOTE_TYPES } from '../utils/constants';
import { formatCountdown } from '../utils/formatters';
import Loader from './Loader';
import blockchainDataCache from '../utils/blockchainDataCache';

const VoteTab = ({ proposals, castVote, hasVoted, getVotingPower, voting, account, governanceContract, provider, contractAddress, getProposalVoteTotals }) => {
  const [voteFilter, setVoteFilter] = useState('active');
  const [votingPowers, setVotingPowers] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [quorum, setQuorum] = useState(null);
  const [proposalVoteData, setProposalVoteData] = useState({});
  
  // Replace govParams state with the hook
  const govParams = useGovernanceParams(governanceContract);
  
  // Track locally which proposals the user has voted on and how
  const [votedProposals, setVotedProposals] = useState({});
  
  /**
   * Check if a proposal is inactive
   * @param {Object} proposal - The proposal object
   * @returns {boolean} - True if the proposal is inactive
   */
  const isInactiveProposal = useCallback((proposal) => {
    // Check if proposal state is anything other than ACTIVE
    return proposal.state !== PROPOSAL_STATES.ACTIVE;
  }, [PROPOSAL_STATES]);

  /**
   * Get the cache key for a proposal's vote data
   * @param {string} proposalId - The proposal ID
   * @returns {string} - Cache key
   */
  const getVoteDataCacheKey = (proposalId) => {
    return `dashboard-votes-${proposalId}`;
  };

  /**
   * Get vote data for a proposal with unified handling for all proposal states
   * @param {string} proposalId - The proposal ID
   * @param {boolean} forceRefresh - Whether to force refresh from the blockchain
   * @returns {Promise<Object>} - Vote data
   */
  const getProposalVoteDataWithCaching = async (proposalId, forceRefresh = false) => {
    // Find the proposal
    const proposal = proposals.find(p => p.id === proposalId);
    if (!proposal) {
      console.error(`Proposal #${proposalId} not found`);
      return null;
    }
    
    const cacheKey = getVoteDataCacheKey(proposalId);
    
    // Try to get from cache first, unless force refresh is requested
    if (!forceRefresh) {
      const cachedData = blockchainDataCache.get(cacheKey);
      if (cachedData) {
        console.log(`Using cached data for proposal #${proposalId}`);
        return cachedData;
      }
    }
    
    // If force refresh is requested, clear the cache
    if (forceRefresh) {
      blockchainDataCache.delete(cacheKey);
    }
    
    try {
      // Get fresh data from the blockchain - works for both active and inactive proposals
      console.log(`Fetching vote data for proposal #${proposalId} (state: ${proposal.state})`);
      const data = await getProposalVoteTotals(proposalId);
      
      if (!data) {
        throw new Error(`No data returned for proposal #${proposalId}`);
      }
      
      // Process the data consistently with Dashboard approach
      const processedData = {
        yesVotes: parseFloat(data.yesVotes) || 0,
        noVotes: parseFloat(data.noVotes) || 0,
        abstainVotes: parseFloat(data.abstainVotes) || 0,
        yesVotingPower: parseFloat(data.yesVotes || data.yesVotingPower) || 0,
        noVotingPower: parseFloat(data.noVotes || data.noVotingPower) || 0,
        abstainVotingPower: parseFloat(data.abstainVotes || data.abstainVotingPower) || 0,
        totalVoters: parseInt(data.totalVoters) || 0,
        fetchedAt: Date.now()
      };
      
      // Calculate total voting power
      processedData.totalVotingPower = 
        processedData.yesVotingPower + 
        processedData.noVotingPower + 
        processedData.abstainVotingPower;
      
      // Calculate percentages
      if (processedData.totalVotingPower > 0) {
        processedData.yesPercentage = (processedData.yesVotingPower / processedData.totalVotingPower) * 100;
        processedData.noPercentage = (processedData.noVotingPower / processedData.totalVotingPower) * 100;
        processedData.abstainPercentage = (processedData.abstainVotingPower / processedData.totalVotingPower) * 100;
      } else {
        processedData.yesPercentage = 0;
        processedData.noPercentage = 0;
        processedData.abstainPercentage = 0;
      }
      
      // Set TTL based on proposal state
      let ttlSeconds = 60; // Short TTL for active proposals to ensure freshness
      
      // For inactive proposals, use a much longer TTL
      if (isInactiveProposal(proposal)) {
        ttlSeconds = 86400 * 30; // 30 days for inactive proposals
      }
      
      // Cache the result with appropriate TTL
      blockchainDataCache.set(cacheKey, processedData, ttlSeconds);
      
      return processedData;
    } catch (error) {
      console.error(`Error fetching vote data for proposal ${proposalId}:`, error);
      
      // Try to use proposal data directly if blockchain query failed
      try {
        console.log(`Constructing fallback data from proposal object for #${proposalId}`);
        const fallbackData = {
          yesVotes: proposal.votedYes ? 1 : 0,
          noVotes: proposal.votedNo ? 1 : 0,
          abstainVotes: (proposal.hasVoted && !proposal.votedYes && !proposal.votedNo) ? 1 : 0,
          yesVotingPower: parseFloat(proposal.yesVotes) || 0,
          noVotingPower: parseFloat(proposal.noVotes) || 0,
          abstainVotingPower: parseFloat(proposal.abstainVotes) || 0,
          totalVoters: proposal.hasVoted ? 1 : 0,
          fetchedAt: Date.now()
        };
        
        // Calculate total voting power
        fallbackData.totalVotingPower = 
          fallbackData.yesVotingPower + 
          fallbackData.noVotingPower + 
          fallbackData.abstainVotingPower;
        
        // Calculate percentages
        if (fallbackData.totalVotingPower > 0) {
          fallbackData.yesPercentage = (fallbackData.yesVotingPower / fallbackData.totalVotingPower) * 100;
          fallbackData.noPercentage = (fallbackData.noVotingPower / fallbackData.totalVotingPower) * 100;
          fallbackData.abstainPercentage = (fallbackData.abstainVotingPower / fallbackData.totalVotingPower) * 100;
        } else {
          fallbackData.yesPercentage = 0;
          fallbackData.noPercentage = 0;
          fallbackData.abstainPercentage = 0;
        }
        
        // Cache this fallback data - use shorter TTL since it's fallback data
        let ttlSeconds = 300; // 5 minutes for active proposals
        if (isInactiveProposal(proposal)) {
          ttlSeconds = 86400 * 7; // 7 days for inactive proposals
        }
        blockchainDataCache.set(cacheKey, fallbackData, ttlSeconds);
        
        return fallbackData;
      } catch (fallbackErr) {
        console.error("Error creating fallback data:", fallbackErr);
        
        // Return empty data structure as last resort
        return {
          yesVotes: 0,
          noVotes: 0,
          abstainVotes: 0,
          yesVotingPower: 0,
          noVotingPower: 0,
          abstainVotingPower: 0,
          totalVoters: 0,
          totalVotingPower: 0,
          yesPercentage: 0,
          noPercentage: 0,
          abstainPercentage: 0,
          fetchedAt: Date.now()
        };
      }
    }
  };

  // Create a helper function to archive vote data when a proposal becomes inactive
  const archiveProposalVoteData = async (proposalId) => {
    const proposal = proposals.find(p => p.id === proposalId);
    if (!proposal) {
      console.error(`Proposal #${proposalId} not found for archiving`);
      return;
    }
    
    const cacheKey = getVoteDataCacheKey(proposalId);
    const cachedData = blockchainDataCache.get(cacheKey);
    
    if (cachedData) {
      // If we already have data in the cache, update it with a long TTL
      console.log(`Archiving existing vote data for proposal #${proposalId}`);
      blockchainDataCache.set(cacheKey, cachedData, 86400 * 30); // 30 days
    } else {
      // Try to get fresh data one last time and archive it
      try {
        console.log(`Fetching fresh data for archiving proposal #${proposalId}`);
        const data = await getProposalVoteTotals(proposalId);
        
        if (data) {
          const processedData = {
            yesVotes: parseFloat(data.yesVotes) || 0,
            noVotes: parseFloat(data.noVotes) || 0,
            abstainVotes: parseFloat(data.abstainVotes) || 0,
            yesVotingPower: parseFloat(data.yesVotes || data.yesVotingPower) || 0,
            noVotingPower: parseFloat(data.noVotes || data.noVotingPower) || 0,
            abstainVotingPower: parseFloat(data.abstainVotes || data.abstainVotingPower) || 0,
            totalVoters: parseInt(data.totalVoters) || 0,
            fetchedAt: Date.now()
          };
          
          // Calculate total voting power
          processedData.totalVotingPower = 
            processedData.yesVotingPower + 
            processedData.noVotingPower + 
            processedData.abstainVotingPower;
          
          // Calculate percentages
          if (processedData.totalVotingPower > 0) {
            processedData.yesPercentage = (processedData.yesVotingPower / processedData.totalVotingPower) * 100;
            processedData.noPercentage = (processedData.noVotingPower / processedData.totalVotingPower) * 100;
            processedData.abstainPercentage = (processedData.abstainVotingPower / processedData.totalVotingPower) * 100;
          } else {
            processedData.yesPercentage = 0;
            processedData.noPercentage = 0;
            processedData.abstainPercentage = 0;
          }
          
          blockchainDataCache.set(cacheKey, processedData, 86400 * 30); // 30 days
          console.log(`Archived fresh vote data for proposal #${proposalId}`);
        }
      } catch (error) {
        console.error(`Error archiving vote data for proposal ${proposalId}:`, error);
      }
    }
  };
  
  // Format numbers for display - MATCHING DASHBOARD
  const formatNumberDisplay = (value) => {
    if (value === undefined || value === null) return "0";
    
    // Handle string inputs
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    
    // If it's NaN or not a number, return "0"
    if (isNaN(numValue)) return "0";
    
    // For whole numbers, don't show decimals
    if (Math.abs(numValue - Math.round(numValue)) < 0.00001) {
      return numValue.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    
    // For decimal numbers, limit to 2 decimal places
    return numValue.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  };
  
  // Format token values to 5 decimal places - MATCHING DASHBOARD
  const formatToFiveDecimals = (value) => {
    if (value === undefined || value === null) return "0.00000";
    
    // Handle string inputs
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    
    // If it's NaN or not a number, return "0.00000"
    if (isNaN(numValue)) return "0.00000";
    
    // Return with exactly 5 decimal places
    return numValue.toFixed(5);
  };
  
  // Format date correctly
  const formatDate = (timestamp) => {
    if (!timestamp) return "Unknown";
    
    // Convert seconds to milliseconds if needed
    const dateValue = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    
    try {
      return new Date(dateValue).toLocaleDateString();
    } catch (error) {
      console.error("Error formatting date:", error);
      return "Invalid Date";
    }
  };
  
  // Fetch vote data for all proposals - UNIFIED APPROACH FOR ALL STATES
  useEffect(() => {
    const fetchVoteData = async () => {
      if (!getProposalVoteTotals || !proposals || proposals.length === 0) return;
      
      console.log("Fetching vote data for all proposals");
      setLoading(true);
      
      try {
        const voteData = {};
        
        // Process proposals in batches to avoid overwhelming the network
        const batchSize = 5;
        const batches = [];
        
        for (let i = 0; i < proposals.length; i += batchSize) {
          batches.push(proposals.slice(i, i + batchSize));
        }
        
        for (const batch of batches) {
          const results = await Promise.allSettled(
            batch.map(async (proposal) => {
              try {
                // Define when to force refresh based on proposal state and cache status
                const cacheKey = getVoteDataCacheKey(proposal.id);
                const cachedData = blockchainDataCache.get(cacheKey);
                
                // Determine if we need to force refresh:
                // 1. Always force refresh if no cached data
                // 2. For active proposals, refresh if data is older than 60 seconds
                // 3. For inactive proposals, refresh if data is older than 1 hour
                const forceRefresh = 
                  !cachedData || // No cached data
                  (proposal.state === PROPOSAL_STATES.ACTIVE && cachedData.fetchedAt && (Date.now() - cachedData.fetchedAt) > 60000) || // Active proposal with stale data (1 minute)
                  (proposal.state !== PROPOSAL_STATES.ACTIVE && cachedData.fetchedAt && (Date.now() - cachedData.fetchedAt) > 3600000); // Inactive proposal with stale data (1 hour)
                
                console.log(`Fetching data for proposal #${proposal.id}, state: ${proposal.state}, force refresh: ${forceRefresh}`);
                const data = await getProposalVoteDataWithCaching(proposal.id, forceRefresh);
                
                if (!data) {
                  return { id: proposal.id, data: null };
                }
                
                return { id: proposal.id, data: data };
              } catch (error) {
                console.error(`Error fetching vote data for proposal ${proposal.id}:`, error);
                return { id: proposal.id, data: null };
              }
            })
          );
          
          // Collect successful results from this batch
          results.forEach(result => {
            if (result.status === 'fulfilled' && result.value && result.value.data) {
              voteData[result.value.id] = result.value.data;
            }
          });
          
          // Small delay between batches to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log("Setting proposalVoteData state with:", voteData);
        setProposalVoteData(voteData);
      } catch (error) {
        console.error("Error fetching vote data:", error);
      } finally {
        setLoading(false);
      }
    };
    
    // Initial fetch
    fetchVoteData();
    
    // Adaptive polling interval based on whether there are active proposals
    const hasActiveProposals = proposals.some(p => p.state === PROPOSAL_STATES.ACTIVE);
    const pollInterval = setInterval(() => {
      fetchVoteData();
    }, hasActiveProposals ? 15000 : 60000); // More frequent for active proposals
    
    // Set up event listener for VoteCast events to update data in real-time
    const setupEventListener = () => {
      if (governanceContract) {
        // Listen for VoteCast events
        governanceContract.on('VoteCast', (voter, proposalId, support, votes, event) => {
          console.log(`Vote cast by ${voter} on proposal ${proposalId}`);
          
          // Force immediate refresh of vote data
          setTimeout(() => {
            refreshVoteDataForProposal(proposalId.toString());
          }, 1000);
        });
        
        // Also listen for ProposalEvent to detect state changes
        governanceContract.on('ProposalEvent', (proposalId, eventType, data, event) => {
          console.log(`Proposal event for ${proposalId}, type: ${eventType}`);
          
          // Force refresh when proposal state changes
          if (eventType > 0) { // 0 is creation, others are state changes
            setTimeout(() => {
              refreshVoteDataForProposal(proposalId.toString());
            }, 1000);
          }
        });
        
        console.log("Set up event listeners");
      }
    };
    
    setupEventListener();
    
    return () => {
      clearInterval(pollInterval);
      // Remove event listeners
      if (governanceContract) {
        governanceContract.removeAllListeners('VoteCast');
        governanceContract.removeAllListeners('ProposalEvent');
      }
    };
  }, [proposals, getProposalVoteTotals, governanceContract, isInactiveProposal, PROPOSAL_STATES]);

  // Refresh vote data for a specific proposal - ensures sync with dashboard
  const refreshVoteDataForProposal = async (proposalId) => {
    if (!getProposalVoteTotals) return;
    
    try {
      console.log(`Refreshing vote data for proposal #${proposalId}`);
      
      // Find the proposal to check its state
      const proposal = proposals.find(p => p.id === proposalId);
      
      if (!proposal) {
        console.error(`Proposal #${proposalId} not found for refresh`);
        return;
      }
      
      // Always force refresh for specific proposal refreshes to ensure latest data
      const updatedData = await getProposalVoteDataWithCaching(proposalId, true);
      
      if (updatedData) {
        // Update the state
        setProposalVoteData(prev => ({
          ...prev,
          [proposalId]: updatedData
        }));
        
        // If this is an inactive proposal, also archive the data for long-term storage
        if (isInactiveProposal(proposal)) {
          archiveProposalVoteData(proposalId);
        }
      }
    } catch (error) {
      console.error(`Error refreshing vote data for proposal ${proposalId}:`, error);
    }
  };

  // Fetch voting powers for each proposal
  useEffect(() => {
    const fetchVotingPowers = async () => {
      if (!getVotingPower || !proposals.length || !account) return;
      
      const powers = {};
      for (const proposal of proposals) {
        try {
          if (proposal.snapshotId) {
            // Try to get from cache first
            const cacheKey = `votingPower-${account}-${proposal.snapshotId}`;
            const cachedPower = blockchainDataCache.get(cacheKey);
            if (cachedPower !== null) {
              powers[proposal.id] = cachedPower;
              continue;
            }
            
            const power = await getVotingPower(proposal.snapshotId);
            powers[proposal.id] = power;
            
            // Cache the result with long TTL since snapshot data is historical
            const ttl = 86400 * 7; // 7 days
            blockchainDataCache.set(cacheKey, power, ttl);
          }
        } catch (err) {
          console.error(`Error getting voting power for proposal ${proposal.id}:`, err);
          powers[proposal.id] = "0";
        }
      }
      
      setVotingPowers(powers);
    };
    
    fetchVotingPowers();
  }, [getVotingPower, proposals, account]);

  // Initialize votedProposals from the proposals data
  useEffect(() => {
    const voted = {};
    proposals.forEach(proposal => {
      if (proposal.hasVoted) {
        // Set default vote type to abstain if not specified
        let voteType = VOTE_TYPES.ABSTAIN;
        if (proposal.votedYes) voteType = VOTE_TYPES.FOR;
        if (proposal.votedNo) voteType = VOTE_TYPES.AGAINST;
        
        voted[proposal.id] = voteType;
        
        console.log(`User has voted on proposal #${proposal.id} with vote type: ${voteType}`);
      }
    });
    setVotedProposals(voted);
    
    // Also ensure that inactive proposals have their vote data stored in the cache
    proposals.filter(isInactiveProposal).forEach(proposal => {
      archiveProposalVoteData(proposal.id);
    });
    
  }, [proposals, isInactiveProposal, VOTE_TYPES]);
  
  // When govParams changes, update the quorum state for backward compatibility
  useEffect(() => {
    setQuorum(govParams.quorum.toString());
  }, [govParams.quorum]);

  // Filter proposals based on vote status
  const filteredProposals = proposals.filter(proposal => {
    // Check if we've locally voted on this proposal
    const locallyVoted = votedProposals[proposal.id] !== undefined;
    
    if (voteFilter === 'active') {
      // Only check if proposal is active, don't exclude based on vote status
      return proposal.state === PROPOSAL_STATES.ACTIVE;
    } else if (voteFilter === 'voted') {
      return proposal.hasVoted || locallyVoted;
    }
    return true; // 'all' filter
  });

  // Check if the user has voted on the proposal (either from data or local state)
  const hasUserVoted = useCallback((proposal) => {
    return proposal.hasVoted || votedProposals[proposal.id] !== undefined;
  }, [votedProposals]);
  
  // Get the vote type
  const getUserVoteType = useCallback((proposal) => {
    // First check our local state
    if (votedProposals[proposal.id] !== undefined) {
      return votedProposals[proposal.id];
    }
    
    // Then fall back to the proposal data
    if (proposal.votedYes) return VOTE_TYPES.FOR;
    if (proposal.votedNo) return VOTE_TYPES.AGAINST;
    if (proposal.hasVoted) return VOTE_TYPES.ABSTAIN;
    
    return null;
  }, [votedProposals]);

  // Get vote data for a proposal - CONSISTENTLY FOR ALL PROPOSAL STATES
  const getVoteData = useCallback((proposal) => {
    // First check if we have data in the state
    const voteData = proposalVoteData[proposal.id];
    
    if (voteData) {
      return voteData;
    }
    
    // Check if we have data in the global cache with the exact dashboard key
    const cachedData = blockchainDataCache.get(getVoteDataCacheKey(proposal.id));
    if (cachedData) {
      return cachedData;
    }
    
    // If not in state or cache, create synthetic data using proposal data
    // This ensures we show something even before the blockchain data loads
    // CONSISTENTLY FOR ALL PROPOSAL STATES
    const syntheticData = {
      yesVotes: 0,
      noVotes: 0,
      abstainVotes: 0,
      yesVotingPower: parseFloat(proposal.yesVotes) || 0,
      noVotingPower: parseFloat(proposal.noVotes) || 0,
      abstainVotingPower: parseFloat(proposal.abstainVotes) || 0,
      totalVoters: 0,
      yesPercentage: 0,
      noPercentage: 0,
      abstainPercentage: 0
    };
    
    // Calculate total voting power
    const totalVotingPower = syntheticData.yesVotingPower + 
                             syntheticData.noVotingPower + 
                             syntheticData.abstainVotingPower;
    
    syntheticData.totalVotingPower = totalVotingPower;
    
    // Calculate percentages if there's any voting power
    if (totalVotingPower > 0) {
      syntheticData.yesPercentage = (syntheticData.yesVotingPower / totalVotingPower) * 100;
      syntheticData.noPercentage = (syntheticData.noVotingPower / totalVotingPower) * 100;
      syntheticData.abstainPercentage = (syntheticData.abstainVotingPower / totalVotingPower) * 100;
    }
    
    // If the user has voted but totals are still 0, enhance the synthetic data
    // This is important for all proposal states, not just active ones
    if ((totalVotingPower === 0 || syntheticData.totalVoters === 0) && hasUserVoted(proposal)) {
      const voteType = getUserVoteType(proposal);
      const approxVotingPower = parseFloat(votingPowers[proposal.id] || "0.6");
      
      if (voteType === VOTE_TYPES.FOR) {
        syntheticData.yesVotes = 1;
        syntheticData.yesVotingPower = approxVotingPower;
        syntheticData.totalVoters = 1;
        syntheticData.yesPercentage = 100;
        syntheticData.totalVotingPower = approxVotingPower;
      } else if (voteType === VOTE_TYPES.AGAINST) {
        syntheticData.noVotes = 1;
        syntheticData.noVotingPower = approxVotingPower;
        syntheticData.totalVoters = 1;
        syntheticData.noPercentage = 100;
        syntheticData.totalVotingPower = approxVotingPower;
      } else if (voteType === VOTE_TYPES.ABSTAIN) {
        syntheticData.abstainVotes = 1;
        syntheticData.abstainVotingPower = approxVotingPower;
        syntheticData.totalVoters = 1;
        syntheticData.abstainPercentage = 100;
        syntheticData.totalVotingPower = approxVotingPower;
      }
    }
    
    return syntheticData;
  }, [proposalVoteData, hasUserVoted, getUserVoteType, votingPowers, VOTE_TYPES]);

  // Function to submit a vote - Removed optimistic rendering
  const submitVote = async (proposalId, support) => {
    try {
      // Find the proposal in the list
      const proposal = proposals.find(p => p.id === proposalId);
      if (!proposal) {
        console.error("Proposal not found:", proposalId);
        return;
      }
      
      console.log(`Submitting vote for proposal #${proposalId} with type ${support}`);
      
      // Actually send the vote transaction to the blockchain
      const result = await castVote(proposalId, support);
      console.log("Vote transaction confirmed:", result);
      
      // Update the voted proposals state
      setVotedProposals(prev => ({
        ...prev,
        [proposalId]: support
      }));
      
      // Force refresh vote data after transaction is confirmed
      await refreshVoteDataForProposal(proposalId);
      
      // Then set another refresh after a longer delay to catch any indexer updates
      setTimeout(() => {
        refreshVoteDataForProposal(proposalId);
      }, 10000);
      
      return result;
    } catch (error) {
      console.error("Error submitting vote:", error);
      
      // Propagate the error
      throw error;
    }
  };

  // Helper to convert vote type to text
  const getVoteTypeText = (voteType) => {
    if (voteType === VOTE_TYPES.FOR) return 'Yes';
    if (voteType === VOTE_TYPES.AGAINST) return 'No';
    if (voteType === VOTE_TYPES.ABSTAIN) return 'Abstain';
    return '';
  };
  
  // Helper to get proposal type label
  const getProposalTypeLabel = (proposal) => {
    // Check if proposal has a typeLabel property
    if (proposal.typeLabel) {
      return proposal.typeLabel;
    }
    
    // Fallback to numeric type if available
    if (proposal.type !== undefined) {
      switch (parseInt(proposal.type)) {
        case 0: return "General";
        case 1: return "Withdrawal";
        case 2: return "Token Transfer";
        case 3: return "Governance Change";
        case 4: return "External ERC20 Transfer";
        case 5: return "Token Mint";
        case 6: return "Token Burn";
        default: return "General Proposal";
      }
    }
    
    return "General Proposal";
  };
  
  // Helper to get proposal state label and color
  const getProposalStateInfo = (proposal) => {
    // Get actual state instead of relying on deadline
    const state = proposal.state;
    
    const stateLabels = {
      [PROPOSAL_STATES.ACTIVE]: { label: "Active", color: "bg-yellow-100 text-yellow-800" },
      [PROPOSAL_STATES.CANCELED]: { label: "Canceled", color: "bg-gray-100 text-gray-800" },
      [PROPOSAL_STATES.DEFEATED]: { label: "Defeated", color: "bg-red-100 text-red-800" },
      [PROPOSAL_STATES.SUCCEEDED]: { label: "Succeeded", color: "bg-green-100 text-green-800" },
      [PROPOSAL_STATES.QUEUED]: { label: "Queued", color: "bg-blue-100 text-blue-800" },
      [PROPOSAL_STATES.EXECUTED]: { label: "Executed", color: "bg-green-100 text-green-800" },
      [PROPOSAL_STATES.EXPIRED]: { label: "Expired", color: "bg-gray-100 text-gray-800" }
    };
    
    return stateLabels[parseInt(state)] || { label: "Unknown", color: "bg-gray-100 text-gray-800" };
  };

  // Render vote percentage bar - CONSISTENT WITH DASHBOARD
  const renderVoteBar = useCallback((proposal) => {
    const voteData = getVoteData(proposal);
    const totalVotingPower = voteData.totalVotingPower || 0;
    
    if (totalVotingPower <= 0) {
      // Default empty bar if no votes
      return (
        <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full w-full bg-gray-300"></div>
        </div>
      );
    }
    
    // Show vote percentages with color coding - SAME AS DASHBOARD
    return (
      <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
        <div className="flex h-full">
          <div 
            className="bg-green-500 h-full" 
            style={{ width: `${voteData.yesPercentage}%` }}
          ></div>
          <div 
            className="bg-red-500 h-full" 
            style={{ width: `${voteData.noPercentage}%` }}
          ></div>
          <div 
            className="bg-gray-400 h-full" 
            style={{ width: `${voteData.abstainPercentage}%` }}
          ></div>
        </div>
      </div>
    );
  }, [getVoteData]);

  // Helper to format time durations in a human-readable way
  const formatTimeDuration = (seconds) => {
    if (!seconds || isNaN(seconds)) return "0 minutes";
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days} day${days !== 1 ? 's' : ''} ${hours} hour${hours !== 1 ? 's' : ''}`;
    } else if (hours > 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else {
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold">Vote</h2>
        <p className="text-gray-500">Cast your votes on active proposals</p>
      </div>
      
      {/* Simplified Governance Parameters Section */}
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <div className="mb-4">
          <div className="flex items-center">
            <Settings className="h-5 w-5 text-indigo-600 mr-2" />
            <h3 className="text-lg font-medium">Governance Parameters</h3>
            {govParams.loading && <Loader size="small" className="ml-2" />}
          </div>
          {govParams.error && (
            <div className="text-sm text-red-500 mt-1">
              {govParams.error}
            </div>
          )}
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-indigo-50 p-3 rounded-lg">
            <div className="text-sm text-indigo-700 font-medium">Quorum</div>
            <div className="text-lg font-bold">{govParams.formattedQuorum} JST</div>
          </div>
          <div className="bg-indigo-50 p-3 rounded-lg">
            <div className="text-sm text-indigo-700 font-medium">Voting Duration</div>
            <div className="text-lg font-bold">{govParams.formattedDuration}</div>
          </div>
          <div className="bg-indigo-50 p-3 rounded-lg">
            <div className="text-sm text-indigo-700 font-medium">Proposal Threshold</div>
            <div className="text-lg font-bold">{govParams.formattedThreshold} JST</div>
          </div>
          <div className="bg-indigo-50 p-3 rounded-lg">
            <div className="text-sm text-indigo-700 font-medium">Proposal Stake</div>
            <div className="text-lg font-bold">{govParams.formattedStake} JST</div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-700 font-medium">Defeated Refund</div>
            <div className="text-lg">{govParams.defeatedRefundPercentage}%</div>
          </div>
          <div className="p-3 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-700 font-medium">Canceled Refund</div>
            <div className="text-lg">{govParams.canceledRefundPercentage}%</div>
          </div>
          <div className="p-3 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-700 font-medium">Expired Refund</div>
            <div className="text-lg">{govParams.expiredRefundPercentage}%</div>
          </div>
          <div className="p-3 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-700 font-medium">Timelock Delay</div>
            <div className="text-lg">{govParams.formattedTimelock}</div>
          </div>
        </div>
      </div>
      
      {/* Filter options */}
      <div className="bg-white p-6 rounded-lg shadow mb-8">
        <div className="flex flex-wrap gap-3">
          {['active', 'voted', 'all'].map(filter => (
            <button
              key={filter}
              className={`px-4 py-2 rounded-full text-sm ${voteFilter === filter ? 'bg-indigo-100 text-indigo-800 font-medium' : 'bg-gray-100 text-gray-800'}`}
              onClick={() => setVoteFilter(filter)}
            >
              {filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
      </div>
      
      {/* Voting cards */}
      <div className="space-y-8">
        {voting.loading || loading ? (
          <div className="flex justify-center py-8">
            <Loader size="large" text="Loading proposals..." />
          </div>
        ) : filteredProposals.length > 0 ? (
          filteredProposals.map((proposal, idx) => {
            // Get voting power for this proposal
            const votingPower = votingPowers[proposal.id] || "0";
            const hasVotingPower = parseFloat(votingPower) > 0;
            
            // Check if the user has voted
            const userVoted = hasUserVoted(proposal);
            const voteType = getUserVoteType(proposal);
            
            // Get vote data
            const voteData = getVoteData(proposal);
            
            // Get proposal state info for status display
            const stateInfo = getProposalStateInfo(proposal);
            
            return (
              <div key={idx} className="bg-white p-8 rounded-lg shadow-md">
                <div className="flex justify-between items-start mb-5">
                  <div>
                    <h3 className="text-xl font-medium mb-1">{proposal.title}</h3>
                    <p className="text-sm text-gray-500">Proposal #{proposal.id}</p>
                  </div>
                  <span className={`text-sm ${stateInfo.color} px-3 py-1 rounded-full flex items-center`}>
                    {proposal.state === PROPOSAL_STATES.ACTIVE ? (
                      <>
                        <Clock className="w-4 h-4 mr-1" />
                        {formatCountdown(proposal.deadline)}
                      </>
                    ) : (
                      stateInfo.label
                    )}
                  </span>
                </div>
                
                <p className="text-gray-700 mb-6 text-base">{proposal.description.substring(0, 200)}...</p>
                
                {/* Vote data display */}
                <div className="mb-6">
                  {/* Vote percentages */}
                  <div className="grid grid-cols-3 gap-4 text-sm sm:text-base mb-3">
                    <div className="text-green-600 font-medium">Yes: {voteData.yesPercentage.toFixed(1)}%</div>
                    <div className="text-red-600 font-medium text-center">No: {voteData.noPercentage.toFixed(1)}%</div>
                    <div className="text-gray-600 font-medium text-right">Abstain: {voteData.abstainPercentage.toFixed(1)}%</div>
                  </div>
                  
                  {/* Vote bar */}
                  {renderVoteBar(proposal)}
                  
                  {/* Vote counts */}
                  <div className="grid grid-cols-3 gap-4 text-sm text-gray-500 mt-2">
                    <div>{Math.round(voteData.yesVotes)} voter{Math.round(voteData.yesVotes) !== 1 && 's'}</div>
                    <div className="text-center">{Math.round(voteData.noVotes)} voter{Math.round(voteData.noVotes) !== 1 && 's'}</div>
                    <div className="text-right">{Math.round(voteData.abstainVotes)} voter{Math.round(voteData.abstainVotes) !== 1 && 's'}</div>
                  </div>
                  
                  {/* Voting power section - FOLLOWING DASHBOARD APPROACH */}
                  <div className="mt-5 border-t pt-4 text-sm text-gray-600">
                    <div className="flex justify-between mb-0">
                    </div>
                    
                    {/* Display voting power values */}
                    <div className="grid grid-cols-3 gap-4 text-sm text-gray-600 mt-1">
                      <div>{formatToFiveDecimals(voteData.yesVotingPower || 0)} JST</div>
                      <div className="text-center">{formatToFiveDecimals(voteData.noVotingPower || 0)} JST</div>
                      <div className="text-right">{formatToFiveDecimals(voteData.abstainVotingPower || 0)} JST</div>
                    </div>
                  </div>
                  
                  {/* Total voters count */}
                  <div className="text-sm text-gray-500 mt-3 text-right">
                    Total voters: {voteData.totalVoters || 0}
                  </div>
                </div>
                
                {userVoted ? (
                  <div className="flex items-center text-base text-gray-700 p-3 bg-blue-50 rounded-lg">
                    <span className="mr-2">You voted:</span>
                    <span className="px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-800 font-medium">
                      {getVoteTypeText(voteType)}
                    </span>
                  </div>
                ) : proposal.state === PROPOSAL_STATES.ACTIVE && (
                  <div>
                    {hasVotingPower ? (
                      <div>
                        <div className="mb-3 text-base text-gray-700 p-3 bg-indigo-50 rounded-lg">
                          Your voting power: <span className="font-medium">{formatToFiveDecimals(votingPower)} JST</span>
                        </div>
                        
                        {govParams.quorum > 0 && (
                          <div className="mt-5 mb-5">
                            <div className="flex justify-between text-sm text-gray-700 mb-2">
                              <span className="font-medium">Quorum Progress</span>
                              <span>
                                {formatNumberDisplay(voteData.totalVotingPower || 0)} / {govParams.formattedQuorum} JST
                                ({Math.min(100, Math.round(((voteData.totalVotingPower || 0) / (govParams.quorum || 1)) * 100))}%)
                              </span>
                            </div>
                            <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="bg-blue-500 h-full rounded-full" 
                                style={{ width: `${Math.min(100, ((voteData.totalVotingPower || 0) / (govParams.quorum || 1)) * 100)}%` }}
                              ></div>
                            </div>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-4 mt-6">
                          <button 
                            className="flex-1 min-w-0 bg-green-500 hover:bg-green-600 text-white py-3 px-2 rounded-lg flex items-center justify-center text-sm sm:text-base font-medium"
                            onClick={() => submitVote(proposal.id, VOTE_TYPES.FOR)}
                            disabled={voting.processing}
                          >
                            <Check className="w-5 h-5 mr-2 flex-shrink-0" />
                            <span className="truncate">Yes</span>
                          </button>
                          <button 
                            className="flex-1 min-w-0 bg-red-500 hover:bg-red-600 text-white py-3 px-2 rounded-lg flex items-center justify-center text-sm sm:text-base font-medium"
                            onClick={() => submitVote(proposal.id, VOTE_TYPES.AGAINST)}
                            disabled={voting.processing}
                          >
                            <X className="w-5 h-5 mr-2 flex-shrink-0" />
                            <span className="truncate">No</span>
                          </button>
                          <button 
                            className="flex-1 min-w-0 bg-gray-500 hover:bg-gray-600 text-white py-3 px-2 rounded-lg flex items-center justify-center text-sm sm:text-base font-medium"
                            onClick={() => submitVote(proposal.id, VOTE_TYPES.ABSTAIN)}
                            disabled={voting.processing}
                          >
                            <span className="truncate">Abstain</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-6 px-6 text-red-500 bg-red-50 rounded-lg my-3">
                        You did not have enough voting power at the time of the proposal snapshot
                      </div>
                    )}
                  </div>
                )}
                
                <div className="mt-6 text-center">
                  <button 
                    className="text-indigo-600 hover:text-indigo-800 text-sm font-medium px-3 py-1.5 border border-indigo-300 rounded-md hover:bg-indigo-50"
                    onClick={() => {
                      setSelectedProposal(proposal);
                      setShowModal(true);
                    }}
                  >
                    View Full Details
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-12 text-gray-500 bg-white p-8 rounded-lg shadow-md">
            No proposals found for this filter
          </div>
        )}
      </div>
      
      {/* Proposal Details Modal */}
      {showModal && selectedProposal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start p-4 border-b">
              <div>
                <h3 className="text-xl font-semibold">{selectedProposal.title}</h3>
                <p className="text-sm text-gray-500">Proposal #{selectedProposal.id}</p>
              </div>
              <button 
                className="text-gray-500 hover:text-gray-700"
                onClick={() => setShowModal(false)}
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4">
              {/* Proposal type and status */}
              <div className="flex flex-wrap gap-2 mb-4">
                <span className="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full">
                  {getProposalTypeLabel(selectedProposal)}
                </span>
                <span className={`text-xs px-2 py-1 rounded-full ${getProposalStateInfo(selectedProposal).color}`}>
                  {getProposalStateInfo(selectedProposal).label}
                </span>
              </div>
              
              {/* Proposal metadata */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="flex items-center text-sm">
                  <Calendar className="w-4 h-4 mr-2 text-gray-500" />
                  <div>
                    <span className="text-gray-600">Created:</span> {formatDate(selectedProposal.createdAt)}
                  </div>
                </div>
                <div className="flex items-center text-sm">
                  <Clock className="w-4 h-4 mr-2 text-gray-500" />
                  <div>
                    <span className="text-gray-600">Deadline:</span> {formatCountdown(selectedProposal.deadline)}
                  </div>
                </div>
                <div className="flex items-center text-sm">
                  <Users className="w-4 h-4 mr-2 text-gray-500" />
                  <div>
                    <span className="text-gray-600">Proposer:</span> {selectedProposal.proposer?.substring(0, 6)}...{selectedProposal.proposer?.slice(-4)}
                  </div>
                </div>
                <div className="flex items-center text-sm">
                  <BarChart2 className="w-4 h-4 mr-2 text-gray-500" />
                  <div>
                    <span className="text-gray-600">Snapshot ID:</span>{" "}
                    {selectedProposal.snapshotId ? `#${selectedProposal.snapshotId}` : "N/A"}
                  </div>
                </div>
              </div>
              
              {/* Full description */}
              <div className="mb-6">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Description</h4>
                <div className="bg-gray-50 p-3 rounded border text-sm whitespace-pre-wrap">
                  {selectedProposal.description.includes('\n') 
                    ? selectedProposal.description.substring(selectedProposal.description.indexOf('\n') + 1) 
                    : selectedProposal.description}
                </div>
              </div>
              
              {/* Vote results */}
              <div className="mb-6">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Voting Results</h4>
                <div className="bg-gray-50 p-4 rounded border">
                  {(() => {
                    const voteData = getVoteData(selectedProposal);
                    
                    return (
                      <>
                        {/* Vote counts */}
                        <h5 className="text-sm font-medium mb-3">Vote Counts (1 vote per person)</h5>
                        
                        <div className="grid grid-cols-3 gap-4 text-center mb-3">
                          <div>
                            <div className="text-green-600 font-medium">{Math.round(voteData.yesVotes)}</div>
                            <div className="text-xs text-gray-500">Yes Votes</div>
                          </div>
                          <div>
                            <div className="text-red-600 font-medium">{Math.round(voteData.noVotes)}</div>
                            <div className="text-xs text-gray-500">No Votes</div>
                          </div>
                          <div>
                            <div className="text-gray-600 font-medium">{Math.round(voteData.abstainVotes)}</div>
                            <div className="text-xs text-gray-500">Abstain</div>
                          </div>
                        </div>
                        
                        {/* Percentage labels */}
                        <div className="grid grid-cols-3 gap-4 text-center mb-3 text-xs text-gray-500">
                          <div>Yes: {voteData.yesPercentage.toFixed(1)}%</div>
                          <div>No: {voteData.noPercentage.toFixed(1)}%</div>
                          <div>Abstain: {voteData.abstainPercentage.toFixed(1)}%</div>
                        </div>
                        
                        {/* Vote bar */}
                        {renderVoteBar(selectedProposal)}
                        
                        {/* Total voters count */}
                        <div className="text-center text-xs text-gray-500 mt-3 mb-5">
                          Total voters: {voteData.totalVoters || 0}
                        </div>
                        
                        {/* Quorum progress */}
                        {govParams.quorum > 0 && (
                          <div className="mt-4 mb-5">
                            <h5 className="text-sm font-medium mb-2">Quorum Progress</h5>
                            <div className="flex justify-between text-xs text-gray-700 mb-2">
                              <span className="font-medium">
                                {Math.min(100, Math.round(((voteData.totalVotingPower || 0) / (govParams.quorum || 1)) * 100))}%
                              </span>
                              <span>
                                {formatNumberDisplay(voteData.totalVotingPower || 0)} / {govParams.formattedQuorum} JST
                              </span>
                            </div>
                            <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="bg-blue-500 h-full rounded-full" 
                                style={{ width: `${Math.min(100, ((voteData.totalVotingPower || 0) / (govParams.quorum || 1)) * 100)}%` }}
                              ></div>
                            </div>
                            {selectedProposal.snapshotId && (
                              <div className="text-xs text-gray-500 mt-1">
                                Quorum calculated at snapshot #{selectedProposal.snapshotId}
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Voting power heading */}
                        <h5 className="text-sm font-medium mt-5 mb-3">Voting Power Distribution</h5>
                        
                        {/* Voting power display */}
                        <div className="grid grid-cols-3 gap-4 text-center mb-3">
                          <div>
                            <div className="text-green-600 font-medium">{formatToFiveDecimals(voteData.yesVotingPower || 0)}</div>
                            <div className="text-xs text-gray-500">Yes JST</div>
                          </div>
                          <div>
                            <div className="text-red-600 font-medium">{formatToFiveDecimals(voteData.noVotingPower || 0)}</div>
                            <div className="text-xs text-gray-500">No JST</div>
                          </div>
                          <div>
                            <div className="text-gray-600 font-medium">{formatToFiveDecimals(voteData.abstainVotingPower || 0)}</div>
                            <div className="text-xs text-gray-500">Abstain JST</div>
                          </div>
                        </div>
                        
                        {/* Total voting power */}
                        <div className="text-center text-xs text-gray-500 mt-3">
                          Total voting power: {formatNumberDisplay(voteData.totalVotingPower || 0)} JST
                        </div>
                      </>
                    );
                  })()}
                  
                  {/* User's vote */}
                  {hasUserVoted(selectedProposal) && (
                    <div className="mt-5 text-center text-sm">
                      <span className="text-gray-600">Your vote:</span> 
                      <span className={`ml-1 font-medium ${
                        getUserVoteType(selectedProposal) === VOTE_TYPES.FOR 
                          ? "text-green-600" 
                          : getUserVoteType(selectedProposal) === VOTE_TYPES.AGAINST
                          ? "text-red-600" 
                          : "text-gray-600"
                      }`}>
                        {getVoteTypeText(getUserVoteType(selectedProposal))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Additional proposal details */}
              {selectedProposal.actions && selectedProposal.actions.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Actions</h4>
                  <div className="bg-gray-50 p-3 rounded border">
                    <ul className="list-disc pl-5 text-sm">
                      {selectedProposal.actions.map((action, i) => (
                        <li key={i} className="mb-1">{action}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              
              {/* Transaction details if available */}
              {selectedProposal.txHash && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Transaction Hash</h4>
                  <div className="bg-gray-50 p-3 rounded border text-sm break-all">
                    {selectedProposal.txHash}
                  </div>
                </div>
              )}
            </div>
            
            <div className="border-t p-4 flex justify-end">
              <button
                className="px-4 py-2 bg-gray-200 rounded-md text-gray-800 hover:bg-gray-300"
                onClick={() => setShowModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoteTab;
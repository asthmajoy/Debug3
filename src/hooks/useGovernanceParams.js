// src/hooks/useGovernanceParams.js
import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../contexts/Web3Context';

export function useGovernanceParams() {
  const { contracts, contractsReady } = useWeb3();
  const [params, setParams] = useState({
    votingDuration: 0,
    quorum: 0,
    timelockDelay: 0,
    proposalCreationThreshold: 0,
    proposalStake: 0,
    defeatedRefundPercentage: 0,
    canceledRefundPercentage: 0,
    expiredRefundPercentage: 0,
    loading: true,
    error: null
  });

  useEffect(() => {
    const fetchParams = async () => {
      if (!contractsReady || !contracts.governance) {
        setParams(prev => ({ ...prev, loading: false, error: 'Governance contract not available' }));
        return;
      }

      try {
        setParams(prev => ({ ...prev, loading: true, error: null }));
        
        console.log("Governance Contract Address:", contracts.governance.address);
        console.log("Available methods:", Object.keys(contracts.governance.functions));
        
        // Try to directly get the govParams struct
        let success = false;
        
        // METHOD 1: Try the govParams() function call
        try {
          const params = await contracts.governance.govParams();
          console.log("Raw govParams response:", params);
          
          // Check if it has the expected properties or array indices
          if (params && (params.votingDuration !== undefined || params[0] !== undefined)) {
            const formattedParams = processGovParams(params);
            if (validateParams(formattedParams)) {
              setParams({...formattedParams, loading: false, error: null});
              success = true;
              console.log("Successfully loaded govParams:", formattedParams);
              return;
            }
          }
        } catch (err) {
          console.warn("Error calling govParams():", err.message);
        }
        
        // METHOD 2: Try accessing each parameter individually if the contract has getter methods
        if (!success) {
          try {
            const individualParams = {};
            
            // Try to get parameters one by one
            if (typeof contracts.governance.getGovernanceParameters === 'function') {
              // Try unified getter if it exists
              const params = await contracts.governance.getGovernanceParameters();
              if (params && params.length >= 8) {
                individualParams.votingDuration = params[0];
                individualParams.quorum = params[1];
                individualParams.timelockDelay = params[2];
                individualParams.proposalCreationThreshold = params[3];
                individualParams.proposalStake = params[4];
                individualParams.defeatedRefundPercentage = params[5];
                individualParams.canceledRefundPercentage = params[6];
                individualParams.expiredRefundPercentage = params[7];
              }
            } else {
              // Try individual getters
              const getters = [
                { name: 'votingDuration', fn: 'votingDuration' },
                { name: 'quorum', fn: 'quorum' },
                { name: 'timelockDelay', fn: 'timelockDelay' },
                { name: 'proposalCreationThreshold', fn: 'proposalCreationThreshold' },
                { name: 'proposalStake', fn: 'proposalStake' },
                { name: 'defeatedRefundPercentage', fn: 'defeatedRefundPercentage' },
                { name: 'canceledRefundPercentage', fn: 'canceledRefundPercentage' },
                { name: 'expiredRefundPercentage', fn: 'expiredRefundPercentage' }
              ];
              
              for (const getter of getters) {
                if (typeof contracts.governance[getter.fn] === 'function') {
                  try {
                    individualParams[getter.name] = await contracts.governance[getter.fn]();
                    console.log(`Got ${getter.name}:`, individualParams[getter.name].toString());
                  } catch (e) {
                    console.warn(`Failed to call ${getter.fn}():`, e.message);
                  }
                }
              }
            }
            
            if (Object.keys(individualParams).length > 0) {
              const formattedParams = processGovParams(individualParams);
              if (validateParams(formattedParams)) {
                setParams({...formattedParams, loading: false, error: null});
                success = true;
                console.log("Successfully loaded individual parameters:", formattedParams);
                return;
              }
            }
          } catch (err) {
            console.warn("Error getting individual parameters:", err.message);
          }
        }

        // METHOD 3: As a last resort, read the state variables directly
        if (!success) {
          try {
            // Use a provider that has access to state variables (might need ethers v5+)
            const provider = new ethers.providers.Web3Provider(window.ethereum);
            
            const storageIndices = [
              { name: 'votingDuration', slot: 12 },
              { name: 'quorum', slot: 13 },
              { name: 'timelockDelay', slot: 14 },
              { name: 'proposalCreationThreshold', slot: 15 },
              { name: 'proposalStake', slot: 16 },
              { name: 'defeatedRefundPercentage', slot: 17 },
              { name: 'canceledRefundPercentage', slot: 18 },
              { name: 'expiredRefundPercentage', slot: 19 }
            ];
            
            const directStateParams = {};
            for (const param of storageIndices) {
              try {
                const value = await provider.getStorageAt(
                  contracts.governance.address, 
                  param.slot
                );
                directStateParams[param.name] = ethers.BigNumber.from(value);
                console.log(`Direct storage read for ${param.name}:`, value);
              } catch (e) {
                console.warn(`Failed to read storage slot ${param.slot}:`, e.message);
              }
            }
            
            if (Object.keys(directStateParams).length > 0) {
              const formattedParams = processGovParams(directStateParams);
              if (validateParams(formattedParams)) {
                setParams({...formattedParams, loading: false, error: null});
                success = true;
                console.log("Successfully loaded parameters from storage:", formattedParams);
                return;
              }
            }
          } catch (err) {
            console.warn("Error reading contract storage:", err.message);
          }
        }
        
        // If we got here, all methods failed
        if (!success) {
          console.log("All methods failed, using hardcoded values");
          
          // Use hardcoded values
          const hardcodedParams = {
            votingDuration: 172800, // 2 days
            quorum: 1000,
            timelockDelay: 43200, // 12 hours
            proposalCreationThreshold: 100,
            proposalStake: 10,
            defeatedRefundPercentage: 50,
            canceledRefundPercentage: 75,
            expiredRefundPercentage: 25,
            loading: false,
            error: "Could not load from contract, using defaults"
          };
          
          setParams(hardcodedParams);
        }
      } catch (error) {
        console.error("Fatal error fetching governance parameters:", error);
        setParams(prev => ({ 
          ...prev, 
          loading: false,
          error: `Error: ${error.message}`
        }));
      }
    };
    
    fetchParams();
  }, [contracts, contractsReady]);
  
  // Helper function to process and format raw parameters
  function processGovParams(rawParams) {
    const formattedParams = {
      votingDuration: 0,
      quorum: 0,
      timelockDelay: 0,
      proposalCreationThreshold: 0,
      proposalStake: 0,
      defeatedRefundPercentage: 0,
      canceledRefundPercentage: 0,
      expiredRefundPercentage: 0
    };
    
    // Handle different possible formats
    if (rawParams) {
      // Named properties (struct-like)
      if (rawParams.votingDuration !== undefined) {
        formattedParams.votingDuration = Number(rawParams.votingDuration);
        if (rawParams.quorum) {
          formattedParams.quorum = typeof rawParams.quorum.toNumber === 'function' ? 
            Number(ethers.utils.formatEther(rawParams.quorum)) : 
            Number(rawParams.quorum) / 1e18;
        }
        formattedParams.timelockDelay = Number(rawParams.timelockDelay);
        if (rawParams.proposalCreationThreshold) {
          formattedParams.proposalCreationThreshold = typeof rawParams.proposalCreationThreshold.toNumber === 'function' ? 
            Number(ethers.utils.formatEther(rawParams.proposalCreationThreshold)) : 
            Number(rawParams.proposalCreationThreshold) / 1e18;
        }
        if (rawParams.proposalStake) {
          formattedParams.proposalStake = typeof rawParams.proposalStake.toNumber === 'function' ? 
            Number(ethers.utils.formatEther(rawParams.proposalStake)) : 
            Number(rawParams.proposalStake) / 1e18;
        }
        formattedParams.defeatedRefundPercentage = Number(rawParams.defeatedRefundPercentage);
        formattedParams.canceledRefundPercentage = Number(rawParams.canceledRefundPercentage);
        formattedParams.expiredRefundPercentage = Number(rawParams.expiredRefundPercentage);
      }
      // Array-like access (ethers.js sometimes returns structs this way)
      else if (rawParams[0] !== undefined) {
        formattedParams.votingDuration = Number(rawParams[0]);
        if (rawParams[1]) {
          formattedParams.quorum = typeof rawParams[1].toNumber === 'function' ? 
            Number(ethers.utils.formatEther(rawParams[1])) : 
            Number(rawParams[1]) / 1e18;
        }
        formattedParams.timelockDelay = Number(rawParams[2]);
        if (rawParams[3]) {
          formattedParams.proposalCreationThreshold = typeof rawParams[3].toNumber === 'function' ? 
            Number(ethers.utils.formatEther(rawParams[3])) : 
            Number(rawParams[3]) / 1e18;
        }
        if (rawParams[4]) {
          formattedParams.proposalStake = typeof rawParams[4].toNumber === 'function' ? 
            Number(ethers.utils.formatEther(rawParams[4])) : 
            Number(rawParams[4]) / 1e18;
        }
        formattedParams.defeatedRefundPercentage = Number(rawParams[5]);
        formattedParams.canceledRefundPercentage = Number(rawParams[6]);
        formattedParams.expiredRefundPercentage = Number(rawParams[7]);
      }
    }
    
    // Fix any NaN values
    Object.keys(formattedParams).forEach(key => {
      if (isNaN(formattedParams[key])) {
        formattedParams[key] = 0;
      }
    });
    
    return formattedParams;
  }
  
  // Validate params have at least some non-zero values
  function validateParams(params) {
    return Object.values(params).some(val => 
      typeof val === 'number' && val > 0 && !isNaN(val));
  }

  // Helper function to format time durations for display
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
  
  // Format token amounts or other numeric values for display
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

  return {
    ...params,
    // Formatted values for display
    formattedDuration: formatTimeDuration(params.votingDuration),
    formattedTimelock: formatTimeDuration(params.timelockDelay),
    formattedQuorum: formatNumberDisplay(params.quorum),
    formattedThreshold: formatNumberDisplay(params.proposalCreationThreshold),
    formattedStake: formatNumberDisplay(params.proposalStake),
    // Utility functions
    formatTimeDuration,
    formatNumberDisplay
  };
}

export default useGovernanceParams;
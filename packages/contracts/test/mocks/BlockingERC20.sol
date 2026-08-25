// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev ERC-20 that reverts on transfers to a blocked address, the way USDC's blacklist does.
///      Used to prove one seller's failing payout cannot abort a batch sweep.
contract BlockingERC20 is ERC20 {
    mapping(address => bool) public blocked;

    error Blocked(address account);

    constructor() ERC20("Blocking", "BLK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function block_(address account) external {
        blocked[account] = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocked[to]) revert Blocked(to);
        super._update(from, to, value);
    }
}

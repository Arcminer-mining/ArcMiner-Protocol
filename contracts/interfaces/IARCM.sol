// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IARCM {
    function mintFromBurn(address to, uint256 amount) external;
    function burn(uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
